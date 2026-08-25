import type { DiagnosticSummary } from '../../contracts/dto/onboarding.js';
import { AppError } from '../../contracts/errors.js';
import type { SqlExecutor } from '../../db/sql.js';
import type { CurriculumScope } from '../../domain/curriculum-scope.js';

export const DIAGNOSTIC_LIMITS = {
  totalQuestions: 24,
  perSubject: 6,
  minQuestions: 4,
} as const;

const SECONDS_PER_KIND: Record<string, number> = {
  mcq_single: 90,
  mcq_multi: 120,
  numeric: 120,
  free_text: 300,
};

const MIN_TIME_LIMIT_SEC = 600;
const MAX_TIME_LIMIT_SEC = 5400;

interface CandidateRow {
  id: string;
  kind: string;
  points: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  topic_id: string;
  
  grade_min: number;
  grade_max: number;
}

async function fetchCandidates(
  sql: SqlExecutor,
  studentId: string,
  scope: CurriculumScope,
  subjectIds: readonly string[],
): Promise<CandidateRow[]> {
  return sql<CandidateRow[]>`
    select q.id, q.kind::text, q.points, q.subject_id, s.code as subject_code,
           s.name_ru as subject_name, q.topic_id, t.grade_min, t.grade_max
      from public.questions q
      join public.topics t on t.id = q.topic_id
      join public.subjects s on s.id = q.subject_id
     where q.bank_pool = 'diagnostic'
       and q.is_active
       and t.is_active
       and s.is_active
       and q.subject_id = any(${[...subjectIds]}::uuid[])
       and t.grade_min <= ${scope.gradeMax}::int
       and t.grade_max >= ${scope.gradeMin}::int
     -- Порядок псевдослучайный, но детерминированный по ученику: тест
     -- не меняется при повторном открытии страницы и различается у разных
     -- учеников. Класс темы участвует в раскладке ниже, а не в порядке.
     order by s.sort_order, md5(${studentId}::text || q.id::text)
  `;
}

function pickQuestions(candidates: readonly CandidateRow[]): CandidateRow[] {
  const bySubject = new Map<string, CandidateRow[]>();
  for (const candidate of candidates) {
    const list = bySubject.get(candidate.subject_id);
    if (list === undefined) {
      bySubject.set(candidate.subject_id, [candidate]);
    } else {
      list.push(candidate);
    }
  }

  const picked: CandidateRow[] = [];
  const usedTopics = new Set<string>();
  const perSubjectCount = new Map<string, number>();
  
  const perSubjectGrade = new Map<string, number>();

  const gradeKey = (candidate: CandidateRow): string =>
    `${candidate.subject_id}:${candidate.grade_max}`;

  
  const passes = [
    { newTopic: true, newGrade: true },
    { newTopic: true, newGrade: false },
    { newTopic: false, newGrade: false },
  ];

  for (const pass of passes) {
    let progress = true;

    while (progress && picked.length < DIAGNOSTIC_LIMITS.totalQuestions) {
      progress = false;

      for (const [subjectId, list] of bySubject) {
        if (picked.length >= DIAGNOSTIC_LIMITS.totalQuestions) {
          break;
        }
        if ((perSubjectCount.get(subjectId) ?? 0) >= DIAGNOSTIC_LIMITS.perSubject) {
          continue;
        }

        const index = list.findIndex(
          (candidate) =>
            (!pass.newTopic || !usedTopics.has(candidate.topic_id)) &&
            (!pass.newGrade || (perSubjectGrade.get(gradeKey(candidate)) ?? 0) === 0),
        );
        if (index === -1) {
          continue;
        }

        const [candidate] = list.splice(index, 1);
        if (candidate === undefined) {
          continue;
        }

        picked.push(candidate);
        usedTopics.add(candidate.topic_id);
        perSubjectCount.set(subjectId, (perSubjectCount.get(subjectId) ?? 0) + 1);
        perSubjectGrade.set(gradeKey(candidate), (perSubjectGrade.get(gradeKey(candidate)) ?? 0) + 1);
        progress = true;
      }
    }
  }

  return picked;
}

function timeLimitFor(questions: readonly CandidateRow[]): number {
  const seconds = questions.reduce(
    (total, question) => total + (SECONDS_PER_KIND[question.kind] ?? 120),
    0,
  );
  const rounded = Math.ceil(seconds / 60) * 60;
  return Math.min(MAX_TIME_LIMIT_SEC, Math.max(MIN_TIME_LIMIT_SEC, rounded));
}

export async function describeDiagnostic(sql: SqlExecutor, assessmentId: string): Promise<DiagnosticSummary> {
  const [meta] = await sql<{ time_limit_sec: number }[]>`
    select time_limit_sec from public.assessments where id = ${assessmentId}
  `;

  const rows = await sql<
    { subject_code: string; subject_name: string; kind: string; n: number }[]
  >`
    select s.code as subject_code, s.name_ru as subject_name, q.kind::text, count(*)::int as n
      from public.assessment_questions aq
      join public.questions q on q.id = aq.question_id
      join public.subjects s on s.id = q.subject_id
     where aq.assessment_id = ${assessmentId}
     group by s.code, s.name_ru, q.kind, s.sort_order
     order by s.sort_order
  `;

  const subjects = new Map<string, { code: string; name: string; question_count: number }>();
  let total = 0;
  let freeText = 0;

  for (const row of rows) {
    total += row.n;
    if (row.kind === 'free_text') {
      freeText += row.n;
    }
    const existing = subjects.get(row.subject_code);
    if (existing === undefined) {
      subjects.set(row.subject_code, {
        code: row.subject_code,
        name: row.subject_name,
        question_count: row.n,
      });
    } else {
      existing.question_count += row.n;
    }
  }

  return {
    assessment_id: assessmentId,
    question_count: total,
    free_text_count: freeText,
    time_limit_sec: meta?.time_limit_sec ?? MIN_TIME_LIMIT_SEC,
    subjects: [...subjects.values()],
  };
}

export interface AssembleResult {
  readonly diagnostic: DiagnosticSummary | null;
  
  readonly unavailableReason: 'not_enough_questions' | null;
  readonly candidatesFound: number;
}

export async function assembleDiagnostic(
  sql: SqlExecutor,
  studentId: string,
  grade: number,
  subjectIds: readonly string[],
  scope: CurriculumScope,
): Promise<AssembleResult> {
  const [existing] = await sql<{ id: string }[]>`
    select id from public.assessments
     where student_id = ${studentId} and kind = 'diagnostic' and is_active
     order by created_at
     limit 1
  `;

  if (existing !== undefined) {
    return {
      diagnostic: await describeDiagnostic(sql, existing.id),
      unavailableReason: null,
      candidatesFound: 0,
    };
  }

  const candidates = await fetchCandidates(sql, studentId, scope, subjectIds);
  const picked = pickQuestions(candidates);

  if (picked.length < DIAGNOSTIC_LIMITS.minQuestions) {
    return {
      diagnostic: null,
      unavailableReason: 'not_enough_questions',
      candidatesFound: picked.length,
    };
  }

  const totalPoints = picked.reduce((sum, question) => sum + Number(question.points), 0);
  const timeLimit = timeLimitFor(picked);

  const outline = [...new Set(picked.map((question) => question.subject_code))].map(
    (code, index) => ({
      step: index + 1,
      kind: 'intro' as const,
      title: picked.find((question) => question.subject_code === code)?.subject_name ?? code,
      duration_min: null,
    }),
  );

  const [assessment] = await sql<{ id: string }[]>`
    insert into public.assessments (
      kind, title, student_id, grade, time_limit_sec, total_points, outline, is_active
    ) values (
      'diagnostic', 'Диагностический тест', ${studentId}, ${grade},
      ${timeLimit}, ${totalPoints}, ${sql.json(outline)}, true
    )
    returning id
  `;

  if (assessment === undefined) {
    throw new AppError('INTERNAL_ERROR', { message: 'Не удалось создать диагностический тест' });
  }

  let position = 1;
  for (const question of picked) {
    await sql`
      insert into public.assessment_questions (assessment_id, question_id, position)
      values (${assessment.id}, ${question.id}, ${position})
    `;
    position += 1;
  }

  return {
    diagnostic: await describeDiagnostic(sql, assessment.id),
    unavailableReason: null,
    candidatesFound: picked.length,
  };
}
