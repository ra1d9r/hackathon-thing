import { z } from 'zod';

import { proposeTaskSet, TASK_QUESTION_TARGET } from '../../ai/ops/task-generation.js';
import type { GeneratedQuestion } from '../../contracts/ai/tasks.js';
import type { LessonOutlineStep } from '../../contracts/ai/roadmap.js';
import type { JsonObject } from '../../contracts/json.js';
import type { SqlExecutor } from '../../db/sql.js';
import { defaultOutline } from '../../modules/roadmap/build.js';
import { loadStudentCurriculum } from '../../modules/curriculum/scope.js';
import {
  attachQuestions,
  bankQuestions,
  insertGeneratedQuestions,
  refreshTotalPoints,
} from '../../modules/tasks/materialize.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../types.js';

const inputSchema = z.object({
  student_id: z.uuid(),
  topic_id: z.uuid(),
  question_count: z.number().int().min(3).max(20).nullable().default(null),
  
  daily_item_id: z.uuid().nullable().default(null),
});

interface TopicContext {
  subjectId: string;
  subjectName: string;
  topicTitle: string;
  gradeMax: number | null;
  aiText: string | null;
  masteryPct: number | null;
}

async function loadTopic(
  sql: SqlExecutor,
  studentId: string,
  topicId: string,
): Promise<TopicContext | null> {
  const [row] = await sql<
    {
      subject_id: string;
      subject_name: string;
      title_ru: string;
      grade_max: number | null;
      ai_text: string | null;
      mastery_pct: string | null;
    }[]
  >`
    select t.subject_id, s.name_ru as subject_name, t.title_ru, t.grade_max,
           (
             select m.ai_text
               from public.material_topics mt
               join public.materials m on m.id = mt.material_id
              where mt.topic_id = t.id
                and m.status = 'published'
                and m.ai_text is not null
              order by mt.weight desc, m.updated_at desc, m.id
              limit 1
           ) as ai_text,
           tm.mastery_pct
      from public.topics t
      join public.subjects s on s.id = t.subject_id
      left join public.student_topic_mastery tm
             on tm.topic_id = t.id and tm.student_id = ${studentId}
     where t.id = ${topicId} and t.is_active
  `;

  if (row === undefined) {
    return null;
  }

  return {
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    topicTitle: row.title_ru,
    gradeMax: row.grade_max,
    aiText: row.ai_text,
    masteryPct: row.mastery_pct === null ? null : Number(row.mastery_pct),
  };
}

export const taskGeneration: JobHandler = async (ctx) => {
  const parsed = inputSchema.safeParse(ctx.job.input);
  if (!parsed.success) {
    throw new PermanentJobError('во входе операции нет ученика или темы', 'BAD_INPUT');
  }

  const {
    student_id: studentId,
    topic_id: topicId,
    question_count: requestedCount,
    daily_item_id: dailyItemId,
  } = parsed.data;

  const topic = await loadTopic(ctx.sql, studentId, topicId);
  if (topic === null) {
    throw new PermanentJobError('тема не найдена или снята с публикации', 'TOPIC_NOT_FOUND');
  }

  const curriculum = await loadStudentCurriculum(ctx.sql, studentId);
  if (!curriculum.subjectIds.includes(topic.subjectId)) {
    
    throw new PermanentJobError('предмет не выбран учеником', 'SUBJECT_NOT_SELECTED');
  }

  const questionCount = requestedCount ?? TASK_QUESTION_TARGET;
  const grade = topic.gradeMax ?? curriculum.grade;

  let generated: readonly GeneratedQuestion[] = [];
  let title: string | null = null;
  let outline: readonly LessonOutlineStep[] = [];
  let rejected = 0;

  const caller = await ctx.model();

  if (caller !== null) {
    const outcome = await proposeTaskSet(caller, {
      topicId,
      topicTitle: topic.topicTitle,
      subjectName: topic.subjectName,
      grade,
      scope: curriculum.scope,
      materialText: topic.aiText,
      masteryPct: topic.masteryPct,
      questionCount,
    });

    await ctx.logCalls(outcome.calls);
    rejected = outcome.rejected;

    if (outcome.questions.length === 0) {
      if (outcome.failure === 'unavailable' && ctx.retryOnModelOutage()) {
        throw new TransientJobError(`провайдер недоступен: ${outcome.reason ?? ''}`);
      }
      ctx.log.warn(
        { job_id: ctx.job.id, failure: outcome.failure, reason: outcome.reason },
        'задача моделью не составлена, берём вопросы из банка',
      );
    } else {
      generated = outcome.questions;
      title = outcome.title;
      outline = outcome.outline;
    }
  }

  const fallbackIds =
    generated.length > 0 ? [] : await bankQuestions(ctx.sql, topicId, grade, questionCount);

  if (generated.length === 0 && fallbackIds.length === 0) {
    throw new PermanentJobError('по теме нет ни материала, ни вопросов', 'NO_QUESTIONS');
  }

  return ctx.applyOnce(async (tx) => {
    const [assessment] = await tx<{ id: string }[]>`
      insert into public.assessments (
        kind, title, subject_id, student_id, grade, outline,
        total_points, source_job_id, is_active
      ) values (
        'ai_task',
        ${title ?? `Задание: ${topic.topicTitle}`},
        ${topic.subjectId},
        ${studentId},
        ${grade},
        ${tx.json(outline.length > 0 ? [...outline] : defaultOutline(topic.topicTitle))},
        0,
        ${generated.length > 0 ? ctx.job.id : null},
        true
      )
      returning id
    `;

    if (assessment === undefined) {
      throw new Error('не удалось создать задание');
    }

    const questionIds =
      generated.length > 0
        ? await insertGeneratedQuestions(tx, {
            studentId,
            subjectId: topic.subjectId,
            topicId,
            grade,
            jobId: ctx.job.id,
            questions: generated,
          })
        : fallbackIds;

    await attachQuestions(tx, assessment.id, questionIds);
    const totalPoints = await refreshTotalPoints(tx, assessment.id);

    
    
    if (dailyItemId !== null) {
      await tx`
        update public.daily_plan_items
           set assessment_id = ${assessment.id}
         where id = ${dailyItemId} and assessment_id is null
      `;
    }

    const result: JsonObject = {
      source: generated.length > 0 ? 'ai' : 'bank',
      assessment_id: assessment.id,
      topic_id: topicId,
      daily_item_id: dailyItemId,
      questions: questionIds.length,
      total_points: totalPoints,
      rejected,
    };

    return result;
  });
};
