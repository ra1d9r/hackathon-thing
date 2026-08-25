import { randomUUID } from 'node:crypto';

import type {
  MockDetailResponse,
  MockListResponse,
  MockScore,
  StartMockResponse,
} from '../../contracts/dto/mocks.js';
import { AppError } from '../../contracts/errors.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import {
  assembleMock,
  scaleSections,
  totalScaledScore,
  type AssembledMock,
  type BlueprintSection,
  type MockCandidate,
} from '../../domain/mock-exam.js';
import { attachQuestions } from '../tasks/materialize.js';
import type { AuthUser } from '../../types/fastify.js';
import { startAttempt } from '../attempts/service.js';
import {
  findActiveMockAttempt,
  loadCandidates,
  loadExamByCodeOrId,
  loadExams,
  loadMockHistory,
  loadSections,
  loadStudentExamProfile,
} from './queries.js';

function assembleFor(
  sections: readonly BlueprintSection[],
  candidates: ReadonlyMap<string, readonly MockCandidate[]>,
  profileSubjectIds: readonly string[],
  seed: string,
): AssembledMock {
  return assembleMock({ sections, candidates, profileSubjectIds, seed });
}

export async function listMocks(sql: Sql, user: AuthUser): Promise<MockListResponse> {
  const [exams, profile] = await Promise.all([
    loadExams(sql),
    loadStudentExamProfile(sql, user.id),
  ]);

  const built = await Promise.all(
    exams.map(async (exam) => {
      const sections = await loadSections(sql, exam.id);
      const candidates = await loadCandidates(sql, exam.id);
      const mock = assembleFor(sections, candidates, profile.profileSubjectIds, user.id);

      return {
        id: exam.id,
        code: exam.code,
        title: exam.title,
        max_score: exam.maxScore,
        time_limit_sec: exam.timeLimitSec,
        grade_min: exam.gradeMin,
        grade_max: exam.gradeMax,
        goal: exam.goal,
        is_target: exam.id === profile.targetExamId,
        ready: mock.shortfall.length === 0,
        question_count: mock.questionIds.length,
      };
    }),
  );

  
  built.sort((a, b) => Number(b.is_target) - Number(a.is_target) || a.code.localeCompare(b.code));

  return { exams: built, profile_subjects: [...profile.profileSubjects] };
}

export async function getMock(
  sql: Sql,
  user: AuthUser,
  examId: string,
): Promise<MockDetailResponse> {
  const exam = await loadExamByCodeOrId(sql, examId);
  if (exam === null) {
    throw new AppError('NOT_FOUND');
  }

  const profile = await loadStudentExamProfile(sql, user.id);
  const sections = await loadSections(sql, exam.id);
  const candidates = await loadCandidates(sql, exam.id);
  const mock = assembleFor(sections, candidates, profile.profileSubjectIds, user.id);

  const assembledBySlot = new Map(
    mock.sections.map((section) => [`${section.slotKind}:${section.slotIndex}`, section]),
  );
  const subjectById = new Map(profile.profileSubjects.map((subject) => [subject.id, subject]));

  return {
    exam: {
      id: exam.id,
      code: exam.code,
      title: exam.title,
      max_score: exam.maxScore,
      time_limit_sec: exam.timeLimitSec,
      grade_min: exam.gradeMin,
      grade_max: exam.gradeMax,
      goal: exam.goal,
      is_target: exam.id === profile.targetExamId,
      ready: mock.shortfall.length === 0,
      question_count: mock.questionIds.length,
    },
    sections: sections.map((section) => {
      const assembled = assembledBySlot.get(`${section.slotKind}:${section.slotIndex}`);
      const chosen = assembled === undefined ? null : subjectById.get(assembled.subjectId);

      return {
        slot_kind: section.slotKind,
        slot_index: section.slotIndex,
        subject:
          section.subjectId !== null
            ? {
                id: section.subjectId,
                code: section.subjectCode ?? '',
                name: section.subjectName ?? '',
              }
            : (chosen ?? null),
        max_points: section.maxPoints,
        question_count: section.questionCount,
        available: assembled?.questionIds.length ?? 0,
      };
    }),
    active_attempt_id: await findActiveMockAttempt(sql, user.id, exam.id),
    history: (await loadMockHistory(sql, user.id, exam.id)).map((row) => ({
      attempt_id: row.attemptId,
      submitted_at: row.submittedAt,
      score: row.score,
      max_score: row.maxScore,
    })),
  };
}

export async function startMock(
  sql: Sql,
  user: AuthUser,
  examId: string,
  requestId: string,
): Promise<StartMockResponse> {
  const exam = await loadExamByCodeOrId(sql, examId);
  if (exam === null) {
    throw new AppError('NOT_FOUND');
  }

  const active = await findActiveMockAttempt(sql, user.id, exam.id);
  if (active !== null) {
    return describeAttempt(sql, active);
  }

  const profile = await loadStudentExamProfile(sql, user.id);
  const sections = await loadSections(sql, exam.id);
  const candidates = await loadCandidates(sql, exam.id);

  
  
  const seed = `${user.id}:${exam.id}:${Date.now()}`;
  const mock = assembleFor(sections, candidates, profile.profileSubjectIds, seed);

  if (mock.questionIds.length === 0) {
    throw new AppError('STATE_CONFLICT', {
      message: 'Для этого экзамена ещё не написан банк заданий',
      details: { exam_code: exam.code },
    });
  }

  const assessmentId = randomUUID();

  await sql.begin(async (tx) => {
    await tx`
      insert into public.assessments (
        id, kind, title, exam_profile_id, student_id, grade,
        time_limit_sec, total_points, outline, is_active
      ) values (
        ${assessmentId}, 'exam_mock', ${`Пробный ${exam.title}`}, ${exam.id},
        ${user.id}, ${profile.grade},
        ${exam.timeLimitSec}, 0,
        ${tx.json(outlineFor(sections, mock))},
        true
      )
    `;

    await attachQuestions(tx, assessmentId, mock.questionIds);

    
    
    await tx`
      update public.assessments a
         set total_points = coalesce((
               select sum(coalesce(aq.points_override, q.points))
                 from public.assessment_questions aq
                 join public.questions q on q.id = aq.question_id
                where aq.assessment_id = a.id
             ), 0)
       where a.id = ${assessmentId}
    `;
  });

  const view = await startAttempt(
    sql,
    user,
    { assessment_id: assessmentId, client_attempt_id: null },
    requestId,
  );

  return {
    attempt_id: view.attempt.id,
    assessment_id: assessmentId,
    question_count: mock.questionIds.length,
    time_limit_sec: exam.timeLimitSec,
    deadline_at: view.attempt.deadline_at,
    shortfall: mock.shortfall.map((item) => ({
      slot_kind: item.slotKind,
      slot_index: item.slotIndex,
      subject_id: item.subjectId,
      requested: item.requested,
      available: item.available,
    })),
  };
}

function outlineFor(
  sections: readonly { slotKind: string; slotIndex: number; subjectName: string | null }[],
  mock: AssembledMock,
): { step: number; kind: string; title: string }[] {
  return mock.sections.map((assembled, index) => {
    const blueprint = sections.find(
      (section) =>
        section.slotKind === assembled.slotKind && section.slotIndex === assembled.slotIndex,
    );

    return {
      step: index + 1,
      kind: 'practice',
      title: blueprint?.subjectName ?? `Секция ${assembled.slotIndex}`,
    };
  });
}

async function describeAttempt(sql: Sql, attemptId: string): Promise<StartMockResponse> {
  const [row] = await sql<
    {
      assessment_id: string;
      deadline_at: Date | null;
      time_limit_sec: number | null;
      question_count: number;
    }[]
  >`
    select att.assessment_id, att.deadline_at, a.time_limit_sec,
           (select count(*)::int from public.assessment_questions aq
             where aq.assessment_id = a.id) as question_count
      from public.attempts att
      join public.assessments a on a.id = att.assessment_id
     where att.id = ${attemptId}
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND');
  }

  return {
    attempt_id: attemptId,
    assessment_id: row.assessment_id,
    question_count: row.question_count,
    time_limit_sec: row.time_limit_sec,
    deadline_at: row.deadline_at?.toISOString() ?? null,
    shortfall: [],
  };
}

export async function mockScoreFor(
  sql: SqlExecutor,
  studentId: string,
  attemptId: string,
): Promise<MockScore | null> {
  const [attempt] = await sql<
    { exam_id: string; exam_code: string; exam_title: string; max_score: string }[]
  >`
    select e.id as exam_id, e.code as exam_code, e.title_ru as exam_title, e.max_score
      from public.attempts att
      join public.assessments a on a.id = att.assessment_id
      join public.exam_profiles e on e.id = a.exam_profile_id
     where att.id = ${attemptId}
       and att.student_id = ${studentId}
       and a.kind = 'exam_mock'
  `;

  if (attempt === undefined) {
    return null;
  }

  const sections = await loadSections(sql, attempt.exam_id);

  
  
  const rows = await sql<
    { subject_id: string; earned: string | null; possible: string | null }[]
  >`
    select q.subject_id,
           sum(coalesce(ans.points_awarded, 0)) as earned,
           sum(coalesce(aq.points_override, q.points)) as possible
      from public.assessment_questions aq
      join public.questions q on q.id = aq.question_id
      join public.attempts att on att.id = ${attemptId}
      left join public.attempt_answers ans
             on ans.attempt_id = att.id and ans.question_id = q.id
     where aq.assessment_id = att.assessment_id
     group by q.subject_id
  `;

  const bySubject = new Map(
    rows.map((row) => [
      row.subject_id,
      { earned: Number(row.earned ?? 0), possible: Number(row.possible ?? 0) },
    ]),
  );

  
  const mandatorySubjects = new Set(
    sections
      .map((section) => section.subjectId)
      .filter((subjectId): subjectId is string => subjectId !== null),
  );
  const profileSubjects = [...bySubject.keys()]
    .filter((subjectId) => !mandatorySubjects.has(subjectId))
    .sort();

  const names = await subjectNames(sql, [...bySubject.keys()]);

  const outcomes = sections.map((section) => {
    const subjectId =
      section.subjectId ?? profileSubjects[section.slotIndex - 1] ?? null;
    const totals = subjectId === null ? undefined : bySubject.get(subjectId);

    return {
      slotKind: section.slotKind,
      slotIndex: section.slotIndex,
      subjectId: subjectId ?? '',
      pointsEarned: totals?.earned ?? 0,
      pointsPossible: totals?.possible ?? 0,
      maxPoints: section.maxPoints,
    };
  });

  const scaled = scaleSections(outcomes);
  const history = await loadMockHistory(sql, studentId, attempt.exam_id, 2);
  const previous = history.find((row) => row.attemptId !== attemptId)?.score ?? null;
  const total = totalScaledScore(scaled);

  return {
    exam: { id: attempt.exam_id, code: attempt.exam_code, title: attempt.exam_title },
    scaled_score: total,
    max_score: Number(attempt.max_score),
    sections: scaled.map((section) => ({
      slot_kind: section.slotKind,
      slot_index: section.slotIndex,
      subject:
        section.subjectId === ''
          ? null
          : {
              id: section.subjectId,
              code: names.get(section.subjectId)?.code ?? '',
              name: names.get(section.subjectId)?.name ?? '',
            },
      points_earned: section.pointsEarned,
      points_possible: section.pointsPossible,
      max_points: section.maxPoints,
      scaled: section.scaled,
      pct:
        section.pointsPossible <= 0
          ? 0
          : Math.round((section.pointsEarned / section.pointsPossible) * 10_000) / 100,
    })),
    delta_vs_previous: previous === null ? null : Math.round((total - previous) * 100) / 100,
  };
}

async function subjectNames(
  sql: SqlExecutor,
  ids: readonly string[],
): Promise<Map<string, { code: string; name: string }>> {
  if (ids.length === 0) {
    return new Map();
  }

  const rows = await sql<{ id: string; code: string; name_ru: string }[]>`
    select id, code, name_ru from public.subjects where id = any(${[...ids]}::uuid[])
  `;

  return new Map(rows.map((row) => [row.id, { code: row.code, name: row.name_ru }]));
}
