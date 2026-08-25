import type { SqlExecutor } from '../../db/sql.js';
import type { BlueprintSection, MockCandidate } from '../../domain/mock-exam.js';

export interface ExamRow {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly maxScore: number;
  readonly timeLimitSec: number | null;
  readonly gradeMin: number | null;
  readonly gradeMax: number | null;
  readonly goal: string | null;
}

export async function loadExams(sql: SqlExecutor): Promise<ExamRow[]> {
  const rows = await sql<
    {
      id: string;
      code: string;
      title_ru: string;
      max_score: string;
      time_limit_sec: number | null;
      grade_min: number | null;
      grade_max: number | null;
      goal: string | null;
    }[]
  >`
    select e.id, e.code, e.title_ru, e.max_score, e.time_limit_sec,
           e.grade_min, e.grade_max, e.goal::text as goal
      from public.exam_profiles e
     where e.is_active
     order by e.code
  `;

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title_ru,
    maxScore: Number(row.max_score),
    timeLimitSec: row.time_limit_sec,
    gradeMin: row.grade_min,
    gradeMax: row.grade_max,
    goal: row.goal,
  }));
}

export async function loadExamByCodeOrId(
  sql: SqlExecutor,
  examId: string,
): Promise<ExamRow | null> {
  const exams = await loadExams(sql);
  return exams.find((exam) => exam.id === examId) ?? null;
}

export async function loadSections(
  sql: SqlExecutor,
  examId: string,
): Promise<(BlueprintSection & { subjectCode: string | null; subjectName: string | null })[]> {
  const rows = await sql<
    {
      slot_kind: string;
      slot_index: number;
      subject_id: string | null;
      subject_code: string | null;
      subject_name: string | null;
      max_points: string;
      question_count: number | null;
    }[]
  >`
    select sec.slot_kind::text, sec.slot_index, sec.subject_id,
           s.code as subject_code, s.name_ru as subject_name,
           sec.max_points, sec.question_count
      from public.exam_sections sec
      left join public.subjects s on s.id = sec.subject_id
     where sec.exam_profile_id = ${examId}
     order by sec.slot_kind, sec.slot_index
  `;

  return rows.map((row) => ({
    slotKind: row.slot_kind === 'profile' ? ('profile' as const) : ('mandatory' as const),
    slotIndex: row.slot_index,
    subjectId: row.subject_id,
    subjectCode: row.subject_code,
    subjectName: row.subject_name,
    maxPoints: Number(row.max_points),
    questionCount: row.question_count,
  }));
}

export async function loadCandidates(
  sql: SqlExecutor,
  examId: string,
): Promise<Map<string, MockCandidate[]>> {
  const rows = await sql<
    {
      id: string;
      subject_id: string;
      topic_id: string;
      difficulty: number;
      points: string;
    }[]
  >`
    select q.id, q.subject_id, q.topic_id, q.difficulty, q.points
      from public.questions q
      join public.topics t on t.id = q.topic_id
      join public.exam_profiles e on e.id = ${examId}
     where q.bank_pool = 'exam_mock'
       and q.is_active
       and t.is_active
       and (e.grade_min is null or t.grade_max >= e.grade_min)
       and (e.grade_max is null or t.grade_min <= e.grade_max)
     order by q.id
  `;

  const grouped = new Map<string, MockCandidate[]>();

  for (const row of rows) {
    const candidate: MockCandidate = {
      questionId: row.id,
      subjectId: row.subject_id,
      topicId: row.topic_id,
      difficulty: row.difficulty,
      points: Number(row.points),
    };

    const list = grouped.get(row.subject_id);
    if (list === undefined) {
      grouped.set(row.subject_id, [candidate]);
    } else {
      list.push(candidate);
    }
  }

  return grouped;
}

export interface StudentExamProfile {
  readonly targetExamId: string | null;
  readonly profileSubjectIds: readonly string[];
  readonly profileSubjects: readonly { id: string; code: string; name: string }[];
  readonly grade: number | null;
}

export async function loadStudentExamProfile(
  sql: SqlExecutor,
  studentId: string,
): Promise<StudentExamProfile> {
  const [profile] = await sql<{ target_exam_id: string | null; grade: number | null }[]>`
    select sp.target_exam_id, p.grade
      from public.student_profiles sp
      join public.profiles p on p.id = sp.student_id
     where sp.student_id = ${studentId}
  `;

  const subjects = await sql<{ id: string; code: string; name_ru: string }[]>`
    select s.id, s.code, s.name_ru
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
     where ss.student_id = ${studentId}
       and ss.removed_at is null
       and ss.is_profile
       and s.is_active
     order by s.sort_order, s.code
  `;

  return {
    targetExamId: profile?.target_exam_id ?? null,
    profileSubjectIds: subjects.map((subject) => subject.id),
    profileSubjects: subjects.map((subject) => ({
      id: subject.id,
      code: subject.code,
      name: subject.name_ru,
    })),
    grade: profile?.grade ?? null,
  };
}

export async function findActiveMockAttempt(
  sql: SqlExecutor,
  studentId: string,
  examId: string,
): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`
    select att.id
      from public.attempts att
      join public.assessments a on a.id = att.assessment_id
     where att.student_id = ${studentId}
       and a.kind = 'exam_mock'
       and a.exam_profile_id = ${examId}
       and att.status = 'in_progress'
     order by att.started_at desc
     limit 1
  `;

  return row?.id ?? null;
}

export interface MockHistoryRow {
  readonly attemptId: string;
  readonly submittedAt: string | null;
  readonly score: number | null;
  readonly maxScore: number;
}

export async function loadMockHistory(
  sql: SqlExecutor,
  studentId: string,
  examId: string,
  limit = 10,
): Promise<MockHistoryRow[]> {
  const rows = await sql<
    { id: string; submitted_at: Date | null; score_pct: string | null; max_score: string }[]
  >`
    select att.id, att.submitted_at, att.score_pct, e.max_score
      from public.attempts att
      join public.assessments a on a.id = att.assessment_id
      join public.exam_profiles e on e.id = a.exam_profile_id
     where att.student_id = ${studentId}
       and a.kind = 'exam_mock'
       and a.exam_profile_id = ${examId}
       and att.status = 'graded'
     order by att.submitted_at desc nulls last, att.id desc
     limit ${limit}
  `;

  return rows.map((row) => ({
    attemptId: row.id,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    
    score:
      row.score_pct === null
        ? null
        : Math.round((Number(row.score_pct) / 100) * Number(row.max_score) * 100) / 100,
    maxScore: Number(row.max_score),
  }));
}
