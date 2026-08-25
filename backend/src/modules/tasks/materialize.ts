import { randomUUID } from 'node:crypto';

import type { GeneratedQuestion } from '../../contracts/ai/tasks.js';
import type { SqlExecutor } from '../../db/sql.js';

export async function bankQuestions(
  sql: SqlExecutor,
  topicId: string,
  grade: number | null,
  limit: number,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id
      from public.questions
     where is_active and origin = 'bank' and topic_id = ${topicId}
     -- Ближе к классу ученика — раньше; дальше порядок детерминированный,
     -- иначе один и тот же запрос давал бы разные наборы.
     order by case when ${grade}::int is null then 0
                   else abs(grade - ${grade}::int) end,
              difficulty, id
     limit ${limit}
  `;

  return rows.map((row) => row.id);
}

export interface GeneratedQuestionsInput {
  readonly studentId: string;
  readonly subjectId: string;
  readonly topicId: string;
  readonly grade: number;
  readonly jobId: string;
  readonly questions: readonly GeneratedQuestion[];
}

export async function insertGeneratedQuestions(
  sql: SqlExecutor,
  input: GeneratedQuestionsInput,
): Promise<string[]> {
  if (input.questions.length === 0) {
    return [];
  }

  
  
  
  
  
  const payload = input.questions.map((question) => ({
    id: randomUUID(),
    kind: question.kind,
    difficulty: question.difficulty,
    prompt_md: question.prompt_md,
    options: question.options,
    answer_key: question.answer_key,
    rubric_md: question.rubric_md,
    explanation_md: question.explanation_md,
    points: question.points,
  }));

  
  
  await sql`
    insert into public.questions (
      id, origin, kind, subject_id, topic_id, grade, difficulty, prompt_md,
      options, answer_key, rubric_md, explanation_md, points,
      generated_for, source_job_id, is_active
    )
    select q.id::uuid, 'generated', q.kind::public.question_kind,
           ${input.subjectId}, ${input.topicId}, ${input.grade}, q.difficulty,
           q.prompt_md, q.options, q.answer_key, q.rubric_md, q.explanation_md,
           q.points, ${input.studentId}, ${input.jobId}, true
      from jsonb_to_recordset(${sql.json(payload)}) as q(
        id text, kind text, difficulty smallint, prompt_md text, options jsonb,
        answer_key jsonb, rubric_md text, explanation_md text, points numeric
      )
  `;

  return payload.map((question) => question.id);
}

export async function refreshTotalPoints(
  sql: SqlExecutor,
  assessmentId: string,
): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    update public.assessments a
       set total_points = coalesce((
             select sum(coalesce(aq.points_override, q.points))
               from public.assessment_questions aq
               join public.questions q on q.id = aq.question_id
              where aq.assessment_id = a.id
           ), 0)
     where a.id = ${assessmentId}
    returning a.total_points as total
  `;

  return Number(row?.total ?? 0);
}

export async function attachQuestions(
  sql: SqlExecutor,
  assessmentId: string,
  questionIds: readonly string[],
): Promise<void> {
  if (questionIds.length === 0) {
    return;
  }

  await sql`
    insert into public.assessment_questions (assessment_id, question_id, position)
    select ${assessmentId}, q.id::uuid, q.ord
      from unnest(${[...questionIds]}::text[]) with ordinality as q(id, ord)
  `;
}
