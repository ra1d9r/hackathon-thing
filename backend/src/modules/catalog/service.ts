import type { LearningGoal, ScaleKind } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import type { SqlExecutor } from '../../db/sql.js';

export interface ExamSummary {
  readonly code: string;
  readonly title: string;
  readonly scale: ScaleKind;
  readonly maxScore: number;
  readonly profileSlotCount: number;
}

interface ExamRow {
  code: string;
  title_ru: string;
  goal: LearningGoal;
  scale_kind: ScaleKind;
  max_score: string;
  profile_slot_count: number;
}

function toSummary(row: ExamRow): ExamSummary {
  return {
    code: row.code,
    title: row.title_ru,
    scale: row.scale_kind,
    maxScore: Number(row.max_score),
    profileSlotCount: row.profile_slot_count,
  };
}

export async function listGoals(sql: SqlExecutor): Promise<
  { goal: LearningGoal; title: string; description: string; exams: ExamSummary[] }[]
> {
  const goals = await sql<
    { goal: LearningGoal; title_ru: string; description_ru: string }[]
  >`
    select goal, title_ru, description_ru
      from public.learning_goals
     where is_active
     order by sort_order, goal
  `;

  const exams = await sql<ExamRow[]>`
    select code, title_ru, goal, scale_kind, max_score, profile_slot_count
      from public.exam_profiles
     where is_active
     order by goal, code
  `;

  return goals.map((goal) => ({
    goal: goal.goal,
    title: goal.title_ru,
    description: goal.description_ru,
    exams: exams.filter((exam) => exam.goal === goal.goal).map(toSummary),
  }));
}

export async function findExam(sql: SqlExecutor, code: string): Promise<ExamSummary & { goal: LearningGoal }> {
  const [row] = await sql<ExamRow[]>`
    select code, title_ru, goal, scale_kind, max_score, profile_slot_count
      from public.exam_profiles
     where code = ${code} and is_active
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Экзамен не найден', details: { exam_code: code } });
  }

  return { ...toSummary(row), goal: row.goal };
}

export interface SubjectOption {
  readonly code: string;
  readonly name: string;
}

export interface SubjectOptions {
  readonly mandatory: SubjectOption[];
  readonly profile: SubjectOption[];
}

export async function listSubjectOptions(
  sql: SqlExecutor,
  examCode: string | null,
): Promise<SubjectOptions> {
  if (examCode === null) {
    const rows = await sql<{ code: string; name_ru: string }[]>`
      select code, name_ru from public.subjects where is_active order by sort_order, code
    `;
    return {
      mandatory: [],
      profile: rows.map((row) => ({ code: row.code, name: row.name_ru })),
    };
  }

  const rows = await sql<{ code: string; name_ru: string; slot_kind: string }[]>`
    select s.code, s.name_ru, o.slot_kind
      from public.exam_subject_options o
      join public.exam_profiles e on e.id = o.exam_profile_id
      join public.subjects s on s.id = o.subject_id
     where e.code = ${examCode} and e.is_active and s.is_active
     order by o.sort_order, s.sort_order
  `;

  return {
    mandatory: rows
      .filter((row) => row.slot_kind === 'mandatory')
      .map((row) => ({ code: row.code, name: row.name_ru })),
    profile: rows
      .filter((row) => row.slot_kind === 'profile')
      .map((row) => ({ code: row.code, name: row.name_ru })),
  };
}

export async function listTopics(
  sql: SqlExecutor,
  subjectCode: string,
  grade: number | null,
): Promise<{
  subject: { code: string; name: string };
  topics: {
    code: string;
    title: string;
    gradeMin: number;
    gradeMax: number;
    examWeight: number;
    prerequisites: string[];
  }[];
}> {
  const [subject] = await sql<{ id: string; code: string; name_ru: string }[]>`
    select id, code, name_ru from public.subjects where code = ${subjectCode} and is_active
  `;

  if (subject === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Предмет не найден', details: { subject_code: subjectCode } });
  }

  const rows = await sql<
    {
      code: string;
      title_ru: string;
      grade_min: number;
      grade_max: number;
      exam_weight: string;
      prerequisites: string[] | null;
    }[]
  >`
    select t.code, t.title_ru, t.grade_min, t.grade_max, t.exam_weight,
           array_remove(array_agg(p.code), null) as prerequisites
      from public.topics t
      left join public.topic_prerequisites tp on tp.topic_id = t.id
      left join public.topics p on p.id = tp.prerequisite_id
     where t.subject_id = ${subject.id}
       and t.is_active
       and (${grade}::int is null or ${grade}::int between t.grade_min and t.grade_max)
     group by t.id, t.code, t.title_ru, t.grade_min, t.grade_max, t.exam_weight, t.sort_order
     order by t.sort_order, t.code
  `;

  return {
    subject: { code: subject.code, name: subject.name_ru },
    topics: rows.map((row) => ({
      code: row.code,
      title: row.title_ru,
      gradeMin: row.grade_min,
      gradeMax: row.grade_max,
      examWeight: Number(row.exam_weight),
      prerequisites: row.prerequisites ?? [],
    })),
  };
}
