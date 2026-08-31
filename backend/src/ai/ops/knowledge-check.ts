import {
  generatedTaskSetEnvelopeSchema,
  generatedTaskSetSchema,
  type GeneratedQuestion,
} from '../../contracts/ai/tasks.js';
import type { LessonOutlineStep } from '../../contracts/ai/roadmap.js';
import { toResponseSchema } from '../../contracts/ai/envelope.js';
import type { JsonValue } from '../../contracts/json.js';
import { mcqQualityBlock, operationBlock, schemaBlock, scopeBlock, studentBlock, systemCoreBlock } from '../prompt.js';
import { callAndValidate, type CallLogEntry, type ModelFailureReason } from '../validate.js';
import type { ModelCaller } from '../types.js';

const TEMPERATURE = 0.4;
const MAX_TOKENS = 12_000;

export const CHECK_QUESTION_TARGET = 5;

const RESPONSE_SCHEMA = toResponseSchema(generatedTaskSetSchema, 'knowledge_check_generation');

export interface KnowledgeCheckContext {
  readonly lessonTitle: string;
  readonly topicId: string;
  readonly topicTitle: string;
  readonly subjectName: string;
  readonly grade: number;
  readonly scope: { readonly gradeMin: number; readonly gradeMax: number; readonly reason: string };
  
  readonly materialText: string;
  
  readonly masteryPct: number | null;
}

export interface KnowledgeCheckOutcome {
  
  readonly title: string | null;
  readonly estMinutes: number | null;
  readonly outline: readonly LessonOutlineStep[];
  readonly questions: readonly GeneratedQuestion[];
  readonly calls: readonly CallLogEntry[];
  readonly failure: ModelFailureReason | null;
  readonly reason: string | null;
  
  readonly rejected: number;
}

function contextPayload(context: KnowledgeCheckContext): JsonValue {
  return {
    lesson: context.lessonTitle,
    subject: context.subjectName,
    grade: context.grade,
    topic: { id: context.topicId, title: context.topicTitle },
    mastery_pct: context.masteryPct,
    material: context.materialText,
  };
}

function difficultyHint(masteryPct: number | null): string {
  if (masteryPct === null) {
    return 'Мастерство по теме не измерялось — держи среднюю сложность (2–3).';
  }
  if (masteryPct < 40) {
    return 'Тема даётся с трудом (мастерство ниже 40 %) — сложность 1–3, без подвохов.';
  }
  if (masteryPct >= 80) {
    return 'Тема освоена (мастерство от 80 %) — сложность 3–5, нужны неочевидные случаи.';
  }
  return 'Тема освоена наполовину — сложность 2–4.';
}

export async function proposeKnowledgeCheck(
  caller: ModelCaller,
  context: KnowledgeCheckContext,
): Promise<KnowledgeCheckOutcome> {
  const blocks = [
    systemCoreBlock(),
    mcqQualityBlock(),
    schemaBlock(RESPONSE_SCHEMA),
    scopeBlock(context.scope, [context.subjectName]),
    studentBlock(contextPayload(context)),
    operationBlock(
      [
        `ЗАДАЧА: составь проверку знаний по уроку «${context.lessonTitle}».`,
        '',
        'Материал урока целиком лежит в STUDENT_CONTEXT, поле material.',
        'Спрашивай только то, что в нём есть. Если какого-то факта в материале',
        'нет — не спрашивай о нём и не додумывай: верни insufficient_context.',
        '',
        `Вопросов: ${CHECK_QUESTION_TARGET}. Виды смешивай — выбор ответа, число,`,
        'один свободный ответ. Всем вопросам topic_id = ' + context.topicId + '.',
        '',
        difficultyHint(context.masteryPct),
        '',
        'Требования к эталонам, иначе вопрос будет отброшен:',
        '— mcq_single: ровно один верный вариант, options не пустые;',
        '— mcq_multi: минимум два верных, но не все;',
        '— для всех MCQ варианты одинаковой длины и детализации; правильный ответ не должен выделяться объёмом или стилем;',
        '— numeric: answer_key = {"value": число, "tolerance": допуск}, options = null;',
        '— free_text: answer_key = {"expected_points": [...]}, обязателен rubric_md,',
        '  options = null.',
        '',
        'explanation_md — почему верный ответ верен, 1–3 предложения. Оно',
        'показывается ученику после проверки, поэтому пиши для него, а не для',
        'проверяющего.',
        '',
        'outline — 3–4 шага, как ученик пройдёт эту проверку.',
      ].join('\n'),
    ),
  ];

  const outcome = await callAndValidate({
    caller,
    schema: generatedTaskSetEnvelopeSchema,
    request: {
      opType: 'knowledge_check_generation',
      blocks,
      schema: RESPONSE_SCHEMA,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    },
  });

  if (!outcome.ok) {
    return {
      title: null,
      estMinutes: null,
      outline: [],
      questions: [],
      calls: outcome.calls,
      failure: outcome.reason,
      reason: outcome.message,
      rejected: 0,
    };
  }

  
  
  const questions = outcome.data.questions.filter(
    (question) => question.topic_id === context.topicId,
  );
  const rejected = outcome.data.questions.length - questions.length;

  if (questions.length === 0) {
    return {
      title: null,
      estMinutes: null,
      outline: [],
      questions: [],
      calls: outcome.calls,
      failure: 'invalid_output',
      reason: 'ни один вопрос не относится к теме урока',
      rejected,
    };
  }

  return {
    title: outcome.data.title,
    estMinutes: outcome.data.est_minutes,
    outline: outcome.data.outline,
    questions,
    calls: outcome.calls,
    failure: null,
    reason: null,
    rejected,
  };
}
