import type { LearningGoal } from '../../contracts/domain.js';
import { learningGoalSchema } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import type { SqlExecutor } from '../../db/sql.js';
import {
  curriculumScope,
  MAX_TOPICS_IN_CONTEXT,
  type CurriculumScope,
} from '../../domain/curriculum-scope.js';

export interface CurriculumSubject {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface StudentCurriculum {
  readonly goal: LearningGoal;
  readonly grade: number;
  readonly examCode: string | null;
  readonly scope: CurriculumScope;
  readonly subjects: readonly CurriculumSubject[];
  readonly subjectIds: readonly string[];
  readonly subjectCodes: readonly string[];
}

interface ProfileRow {
  goal: string;
  grade: number | null;
  exam_code: string | null;
  exam_grade_min: number | null;
  exam_grade_max: number | null;
}

export async function loadStudentCurriculum(
  sql: SqlExecutor,
  studentId: string,
): Promise<StudentCurriculum> {
  const [profile] = await sql<ProfileRow[]>`
    select sp.goal::text as goal, p.grade,
           e.code as exam_code, e.grade_min as exam_grade_min, e.grade_max as exam_grade_max
      from public.student_profiles sp
      join public.profiles p on p.id = sp.student_id
      left join public.exam_profiles e on e.id = sp.target_exam_id
     where sp.student_id = ${studentId}
       and sp.onboarding_completed_at is not null
  `;

  if (profile === undefined) {
    throw new AppError('ONBOARDING_INCOMPLETE');
  }

  const subjects = await sql<{ id: string; code: string; name_ru: string }[]>`
    select s.id, s.code, s.name_ru
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
     where ss.student_id = ${studentId} and ss.removed_at is null and s.is_active
     order by s.sort_order, s.code
  `;

  const goal = learningGoalSchema.parse(profile.goal);
  const grade = profile.grade ?? 11;

  return {
    goal,
    grade,
    examCode: profile.exam_code,
    scope: curriculumScope({
      goal,
      grade,
      exam:
        profile.exam_grade_min === null && profile.exam_grade_max === null
          ? null
          : { gradeMin: profile.exam_grade_min, gradeMax: profile.exam_grade_max },
    }),
    subjects: subjects.map((subject) => ({
      id: subject.id,
      code: subject.code,
      name: subject.name_ru,
    })),
    subjectIds: subjects.map((subject) => subject.id),
    subjectCodes: subjects.map((subject) => subject.code),
  };
}

export interface ScopedTopic {
  readonly topicId: string;
  readonly title: string;
  readonly subjectCode: string;
  readonly gradeMin: number;
  readonly gradeMax: number;
  readonly masteryPct: number | null;
  readonly priority: number;
  readonly hasMaterial: boolean;
}

export interface ScopedTopicsOptions {
  readonly limit?: number;
  readonly withMaterialOnly?: boolean;
}

export async function loadScopedTopics(
  sql: SqlExecutor,
  studentId: string,
  curriculum: StudentCurriculum,
  options: ScopedTopicsOptions = {},
): Promise<ScopedTopic[]> {
  if (curriculum.subjectIds.length === 0) {
    return [];
  }

  const limit = Math.min(options.limit ?? MAX_TOPICS_IN_CONTEXT, MAX_TOPICS_IN_CONTEXT);

  const rows = await sql<
    {
      topic_id: string;
      title_ru: string;
      subject_code: string;
      grade_min: number;
      grade_max: number;
      mastery_pct: string | null;
      priority: string | null;
      has_material: boolean;
    }[]
  >`
    select t.id as topic_id, t.title_ru, s.code as subject_code,
           t.grade_min, t.grade_max,
           m.mastery_pct, m.priority,
           exists (
             select 1
               from public.material_topics mt
               join public.materials mat on mat.id = mt.material_id
              where mt.topic_id = t.id
                and mat.status = 'published'
                and mat.ai_text is not null
           ) as has_material
      from public.topics t
      join public.subjects s on s.id = t.subject_id
      left join public.student_topic_mastery m
             on m.topic_id = t.id and m.student_id = ${studentId}
     where t.is_active
       and s.is_active
       and t.subject_id = any(${[...curriculum.subjectIds]}::uuid[])
       and t.grade_min <= ${curriculum.scope.gradeMax}::int
       and t.grade_max >= ${curriculum.scope.gradeMin}::int
     order by coalesce(m.priority, 0) desc, s.sort_order, t.sort_order, t.id
     limit ${limit}
  `;

  const topics = rows.map((row) => ({
    topicId: row.topic_id,
    title: row.title_ru,
    subjectCode: row.subject_code,
    gradeMin: row.grade_min,
    gradeMax: row.grade_max,
    masteryPct: row.mastery_pct === null ? null : Number(row.mastery_pct),
    priority: Number(row.priority ?? 0),
    hasMaterial: row.has_material,
  }));

  return options.withMaterialOnly === true
    ? topics.filter((topic) => topic.hasMaterial)
    : topics;
}
