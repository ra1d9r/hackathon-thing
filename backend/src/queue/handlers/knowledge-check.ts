import { z } from 'zod';

import {
  CHECK_QUESTION_TARGET,
  proposeKnowledgeCheck,
} from '../../ai/ops/knowledge-check.js';
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

const inputSchema = z.object({ student_id: z.uuid(), lesson_id: z.uuid() });

const BANK_LIMIT = CHECK_QUESTION_TARGET;

interface LessonContext {
  lessonTitle: string;
  subjectId: string;
  subjectName: string;
  topicId: string;
  topicTitle: string;
  gradeMin: number | null;
  gradeMax: number | null;
  aiText: string | null;
  masteryPct: number | null;
}

async function loadContext(
  sql: SqlExecutor,
  studentId: string,
  lessonId: string,
): Promise<LessonContext | null> {
  const [row] = await sql<
    {
      lesson_title: string;
      subject_id: string;
      subject_name: string;
      topic_id: string;
      topic_title: string;
      grade_min: number | null;
      grade_max: number | null;
      ai_text: string | null;
      mastery_pct: string | null;
    }[]
  >`
    select l.title as lesson_title, l.subject_id, s.name_ru as subject_name,
           l.topic_id, t.title_ru as topic_title, l.grade_min, l.grade_max,
           m.ai_text, tm.mastery_pct
      from public.lessons l
      join public.subjects s on s.id = l.subject_id
      join public.topics t on t.id = l.topic_id
      left join public.materials m on m.id = l.material_id and m.status = 'published'
      left join public.student_topic_mastery tm
             on tm.topic_id = l.topic_id and tm.student_id = ${studentId}
     where l.id = ${lessonId} and l.is_active
     limit 1
  `;

  if (row === undefined) {
    return null;
  }

  return {
    lessonTitle: row.lesson_title,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    gradeMin: row.grade_min,
    gradeMax: row.grade_max,
    aiText: row.ai_text,
    masteryPct: row.mastery_pct === null ? null : Number(row.mastery_pct),
  };
}

export const knowledgeCheckGeneration: JobHandler = async (ctx) => {
  const parsed = inputSchema.safeParse(ctx.job.input);
  if (!parsed.success) {
    throw new PermanentJobError('во входе операции нет ученика или урока', 'BAD_INPUT');
  }

  const { student_id: studentId, lesson_id: lessonId } = parsed.data;

  const context = await loadContext(ctx.sql, studentId, lessonId);
  if (context === null) {
    throw new PermanentJobError('урок не найден или снят с публикации', 'LESSON_NOT_FOUND');
  }

  const curriculum = await loadStudentCurriculum(ctx.sql, studentId);

  let generated: readonly GeneratedQuestion[] = [];
  let title: string | null = null;
  let outline: readonly LessonOutlineStep[] = [];
  let rejected = 0;

  const caller = await ctx.model();

  
  
  if (caller !== null && context.aiText !== null && context.aiText.trim() !== '') {
    const outcome = await proposeKnowledgeCheck(caller, {
      lessonTitle: context.lessonTitle,
      topicId: context.topicId,
      topicTitle: context.topicTitle,
      subjectName: context.subjectName,
      grade: context.gradeMax ?? curriculum.grade,
      scope: curriculum.scope,
      materialText: context.aiText,
      masteryPct: context.masteryPct,
    });

    await ctx.logCalls(outcome.calls);
    rejected = outcome.rejected;

    if (outcome.questions.length === 0) {
      if (outcome.failure === 'unavailable' && ctx.retryOnModelOutage()) {
        throw new TransientJobError(`провайдер недоступен: ${outcome.reason ?? ''}`);
      }
      ctx.log.warn(
        { job_id: ctx.job.id, failure: outcome.failure, reason: outcome.reason },
        'проверка знаний моделью не составлена, берём вопросы из банка',
      );
    } else {
      generated = outcome.questions;
      title = outcome.title;
      outline = outcome.outline;
    }
  }

  const fallbackIds =
    generated.length > 0
      ? []
      : await bankQuestions(ctx.sql, context.topicId, context.gradeMax, BANK_LIMIT);

  if (generated.length === 0 && fallbackIds.length === 0) {
    throw new PermanentJobError('по теме урока нет ни материала, ни вопросов', 'NO_QUESTIONS');
  }

  return ctx.applyOnce(async (tx) => {
    
    
    await tx`
      update public.assessments
         set is_active = false
       where kind = 'knowledge_check'
         and student_id = ${studentId}
         and lesson_id = ${lessonId}
         and is_active
    `;

    const [assessment] = await tx<{ id: string }[]>`
      insert into public.assessments (
        kind, title, subject_id, student_id, lesson_id, grade, outline,
        total_points, source_job_id, is_active
      ) values (
        'knowledge_check',
        ${title ?? `Проверка знаний: ${context.topicTitle}`},
        ${context.subjectId},
        ${studentId},
        ${lessonId},
        ${context.gradeMax},
        ${tx.json(outline.length > 0 ? [...outline] : defaultOutline(context.topicTitle))},
        0,
        ${generated.length > 0 ? ctx.job.id : null},
        true
      )
      returning id
    `;

    if (assessment === undefined) {
      throw new Error('не удалось создать проверку знаний');
    }

    const questionIds =
      generated.length > 0
        ? await insertGeneratedQuestions(tx, {
            studentId,
            subjectId: context.subjectId,
            topicId: context.topicId,
            grade: context.gradeMax ?? curriculum.grade,
            jobId: ctx.job.id,
            questions: generated,
          })
        : fallbackIds;

    await attachQuestions(tx, assessment.id, questionIds);

    const result: JsonObject = {
      source: generated.length > 0 ? 'ai' : 'bank',
      assessment_id: assessment.id,
      lesson_id: lessonId,
      questions: questionIds.length,
      total_points: await refreshTotalPoints(tx, assessment.id),
      rejected,
    };

    return result;
  });
};
