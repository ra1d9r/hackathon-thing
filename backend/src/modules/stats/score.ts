import type { LearningGoal, ScaleKind } from '../../contracts/domain.js';
import { learningGoalSchema, roundTo, scaleForGoal } from '../../contracts/domain.js';
import type { JsonObject } from '../../contracts/json.js';
import type { SqlExecutor } from '../../db/sql.js';
import {
  blendWithMock,
  examBaseline,
  scoreConfidence,
  tenScaleBaseline,
  type ExamSection,
  type MockResult,
  type SectionEstimate,
} from '../../domain/predicted-score.js';

export interface ScoreContextData {
  readonly goal: LearningGoal;
  readonly scale: ScaleKind;
  readonly examProfileId: string | null;
  readonly examTitle: string | null;
  readonly maxScore: number;
  readonly baselineValue: number;
  readonly sections: readonly SectionEstimate[];
  readonly confidence: number;
  readonly daysLeft: number | null;
  readonly history: readonly { readonly at: string; readonly value: number }[];
}

interface ProfileRow {
  goal: string;
  target_exam_id: string | null;
  target_date: Date | null;
  exam_code: string | null;
  exam_title: string | null;
  scale_kind: string | null;
  max_score: string | null;
}

interface SectionRow {
  subject_id: string | null;
  slot_kind: 'mandatory' | 'profile';
  slot_index: number;
  max_points: string;
  guess_floor: string;
}

function daysUntil(target: Date | null): number | null {
  if (target === null) {
    return null;
  }
  const diff = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

async function latestMock(
  sql: SqlExecutor,
  studentId: string,
  maxScore: number,
): Promise<MockResult | null> {
  const [row] = await sql<{ score_pct: string | null; days_ago: number }[]>`
    select a.score_pct,
           floor(extract(epoch from (now() - a.submitted_at)) / 86400)::int as days_ago
      from public.attempts a
      join public.assessments s on s.id = a.assessment_id
     where a.student_id = ${studentId}
       and s.kind = 'exam_mock'
       and a.status = 'graded'
       and a.submitted_at is not null
     order by a.submitted_at desc, a.id desc
     limit 1
  `;

  if (row?.score_pct == null) {
    return null;
  }

  return {
    scaledScore: roundTo((Number(row.score_pct) / 100) * maxScore, 2),
    daysAgo: row.days_ago,
  };
}

async function scoreHistory(
  sql: SqlExecutor,
  studentId: string,
  limit = 12,
): Promise<{ at: string; value: number }[]> {
  const rows = await sql<{ computed_at: Date; value: string }[]>`
    select computed_at, value
      from public.predicted_scores
     where student_id = ${studentId}
     order by computed_at desc, id desc
     limit ${limit}
  `;

  return rows
    .map((row) => ({ at: row.computed_at.toISOString(), value: Number(row.value) }))
    .reverse();
}

export async function loadScoreContext(
  sql: SqlExecutor,
  studentId: string,
): Promise<ScoreContextData | null> {
  const [profile] = await sql<ProfileRow[]>`
    select sp.goal::text as goal, sp.target_exam_id, sp.target_date,
           e.code as exam_code, e.title_ru as exam_title,
           e.scale_kind, e.max_score
      from public.student_profiles sp
      left join public.exam_profiles e on e.id = sp.target_exam_id
     where sp.student_id = ${studentId}
       and sp.onboarding_completed_at is not null
  `;

  if (profile === undefined) {
    return null;
  }

  const goal = learningGoalSchema.parse(profile.goal);
  const scale = scaleForGoal(goal);

  const mastery = await sql<{ subject_id: string; mastery_pct: string }[]>`
    select subject_id, mastery_pct
      from public.student_subject_mastery
     where student_id = ${studentId}
  `;

  const subjectMastery = new Map(
    mastery.map((row) => [row.subject_id, Number(row.mastery_pct)]),
  );

  const confidences = await sql<{ confidence: string }[]>`
    select confidence from public.student_topic_mastery where student_id = ${studentId}
  `;

  const [expected] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from public.topics t
      join public.student_subjects ss on ss.subject_id = t.subject_id
     where ss.student_id = ${studentId} and ss.removed_at is null and t.is_active
  `;

  const confidence = scoreConfidence(
    confidences.map((row) => Number(row.confidence)),
    expected?.n ?? 0,
  );

  const history = await scoreHistory(sql, studentId);
  const daysLeft = daysUntil(profile.target_date);

  if (scale === 'ten' || profile.target_exam_id === null) {
    const chosen = await sql<{ subject_id: string }[]>`
      select subject_id from public.student_subjects
       where student_id = ${studentId} and removed_at is null
    `;

    const values = chosen.map((row) => subjectMastery.get(row.subject_id) ?? 0);
    const baseline = tenScaleBaseline(values);

    return {
      goal,
      scale: 'ten',
      examProfileId: null,
      examTitle: null,
      maxScore: baseline.maxScore,
      baselineValue: baseline.value,
      sections: [],
      confidence,
      daysLeft,
      history,
    };
  }

  const sectionRows = await sql<SectionRow[]>`
    select subject_id, slot_kind, slot_index, max_points, guess_floor
      from public.exam_sections
     where exam_profile_id = ${profile.target_exam_id}
     order by slot_kind, slot_index
  `;

  const profileSubjects = await sql<{ subject_id: string }[]>`
    select ss.subject_id
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
     where ss.student_id = ${studentId} and ss.removed_at is null and ss.is_profile
     order by s.sort_order, s.code
  `;

  const sections: ExamSection[] = sectionRows.map((row) => ({
    subjectId: row.subject_id,
    slotKind: row.slot_kind,
    slotIndex: row.slot_index,
    maxPoints: Number(row.max_points),
    guessFloor: Number(row.guess_floor),
  }));

  const maxScore = Number(profile.max_score ?? 0);
  const baseline = examBaseline({
    sections,
    maxScore,
    subjectMastery,
    profileSubjectIds: profileSubjects.map((row) => row.subject_id),
  });

  const mock = await latestMock(sql, studentId, maxScore);
  const blended = blendWithMock(baseline.value, mock);

  return {
    goal,
    scale: 'points',
    examProfileId: profile.target_exam_id,
    examTitle: profile.exam_title,
    maxScore,
    baselineValue: Math.round(blended),
    sections: baseline.sections,
    confidence,
    daysLeft,
    history,
  };
}

export interface StoredScore {
  readonly value: number;
  readonly baselineValue: number;
  readonly maxScore: number;
  readonly scale: ScaleKind;
  readonly confidence: number;
  readonly source: 'ai' | 'baseline';
  readonly computedAt: string;
}

export interface StoreScoreInput {
  readonly context: ScoreContextData;
  readonly value: number;
  readonly source: 'ai' | 'baseline';
  readonly confidence: number;
  readonly breakdown: JsonObject;
  readonly aiJobId?: string | null;
}

export async function storePredictedScore(
  sql: SqlExecutor,
  studentId: string,
  input: StoreScoreInput,
): Promise<StoredScore> {
  const [row] = await sql<{ computed_at: Date }[]>`
    insert into public.predicted_scores (
      student_id, exam_profile_id, scale_kind, value, baseline_value, max_value,
      confidence, breakdown, source, ai_job_id
    ) values (
      ${studentId}, ${input.context.examProfileId}, ${input.context.scale},
      ${input.value}, ${input.context.baselineValue}, ${input.context.maxScore},
      ${input.confidence}, ${sql.json(input.breakdown)}, ${input.source},
      ${input.aiJobId ?? null}
    )
    returning computed_at
  `;

  return {
    value: input.value,
    baselineValue: input.context.baselineValue,
    maxScore: input.context.maxScore,
    scale: input.context.scale,
    confidence: input.confidence,
    source: input.source,
    computedAt: (row?.computed_at ?? new Date()).toISOString(),
  };
}
