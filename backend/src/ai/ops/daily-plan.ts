import { dailyPlanEnvelopeSchema, dailyPlanSchema } from '../../contracts/ai/daily.js';
import { toResponseSchema } from '../../contracts/ai/envelope.js';
import type { JsonValue } from '../../contracts/json.js';
import type { DailyItemKind } from '../../domain/daily.js';
import { operationBlock, schemaBlock, scopeBlock, studentBlock, systemCoreBlock } from '../prompt.js';
import { callAndValidate, type CallLogEntry, type ModelFailureReason } from '../validate.js';
import type { ModelCaller } from '../types.js';

const TEMPERATURE = 0.3;
const MAX_TOKENS = 4_000;

const RESPONSE_SCHEMA = toResponseSchema(dailyPlanSchema, 'daily_plan');

export interface DailyCandidateContext {
  readonly topicId: string;
  readonly title: string;
  readonly subjectName: string;
  readonly masteryPct: number;
  readonly priority: number;
  readonly daysSincePractice: number | null;
  readonly inRoadmap: boolean;
}

export interface DailyPlanContext {
  readonly planDate: string;
  readonly goalTitle: string;
  readonly scope: { readonly gradeMin: number; readonly gradeMax: number; readonly reason: string };
  readonly subjectNames: readonly string[];
  
  readonly current: readonly {
    readonly position: number;
    readonly kind: DailyItemKind;
    readonly topicId: string;
    readonly title: string;
  }[];
  readonly candidates: readonly DailyCandidateContext[];
  
  readonly streakDays: number;
}

export interface DailyPlanItem {
  readonly position: number;
  readonly kind: DailyItemKind;
  readonly topicId: string;
  readonly title: string;
  readonly meta: string;
  readonly estMinutes: number;
}

export interface DailyPlanOutcome {
  
  readonly items: readonly DailyPlanItem[] | null;
  readonly rationale: string | null;
  readonly calls: readonly CallLogEntry[];
  readonly failure: ModelFailureReason | null;
  readonly reason: string | null;
  
  readonly rejected: number;
}

function contextPayload(context: DailyPlanContext): JsonValue {
  return {
    plan_date: context.planDate,
    goal: context.goalTitle,
    streak_days: context.streakDays,
    current_plan: context.current.map((item) => ({
      position: item.position,
      kind: item.kind,
      topic_id: item.topicId,
      title: item.title,
    })),
    candidates: context.candidates.map((candidate) => ({
      topic_id: candidate.topicId,
      title: candidate.title,
      subject: candidate.subjectName,
      mastery_pct: candidate.masteryPct,
      priority: candidate.priority,
      days_since_practice: candidate.daysSincePractice,
      in_roadmap: candidate.inRoadmap,
    })),
  };
}

export async function proposeDailyPlan(
  caller: ModelCaller,
  context: DailyPlanContext,
): Promise<DailyPlanOutcome> {
  const blocks = [
    systemCoreBlock(),
    schemaBlock(RESPONSE_SCHEMA),
    scopeBlock(context.scope, context.subjectNames),
    studentBlock(contextPayload(context)),
    operationBlock(
      [
        `ЗАДАЧА: уточни план занятий на ${context.planDate}.`,
        '',
        'В STUDENT_CONTEXT два списка: current_plan — то, что система уже',
        'собрала и показала ученику, и candidates — темы, из которых можно',
        'выбирать. Твоя работа — улучшить состав и формулировки, а не',
        'придумать план заново.',
        '',
        'Правила, нарушение которых система исправит, отбросив пункт:',
        '1. topic_id — только из candidates.',
        '2. Тема не повторяется.',
        '3. Позиции идут подряд с 1, пунктов от двух до четырёх.',
        '',
        'Держись трёх видов: task — разобрать слабую тему, lesson — пройти',
        'урок, review — повторить освоенное. Три задачи подряд по слабым темам',
        'выглядят наказанием, а не занятием.',
        '',
        'title — по теме и человеческим языком: «Формулы приведения»,',
        'а не «Задание по математике». meta — короткая подпись вида',
        '«20 мин • 5 вопросов».',
        '',
        'rationale — два-три предложения ученику: почему план сегодня такой.',
        context.streakDays > 1
          ? `Серия занятий: ${context.streakDays} дней подряд — это можно отметить.`
          : '',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    ),
  ];

  const outcome = await callAndValidate({
    caller,
    schema: dailyPlanEnvelopeSchema,
    request: {
      opType: 'daily_plan',
      blocks,
      schema: RESPONSE_SCHEMA,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    },
  });

  if (!outcome.ok) {
    return {
      items: null,
      rationale: null,
      calls: outcome.calls,
      failure: outcome.reason,
      reason: outcome.message,
      rejected: 0,
    };
  }

  const allowed = new Set(context.candidates.map((candidate) => candidate.topicId));
  const seen = new Set<string>();
  const items: DailyPlanItem[] = [];
  let rejected = 0;

  for (const item of [...outcome.data.items].sort((a, b) => a.position - b.position)) {
    if (!allowed.has(item.topic_id) || seen.has(item.topic_id)) {
      rejected += 1;
      continue;
    }

    seen.add(item.topic_id);
    items.push({
      
      
      position: items.length + 1,
      kind: item.kind,
      topicId: item.topic_id,
      title: item.title,
      meta: item.meta,
      estMinutes: item.est_minutes,
    });
  }

  if (items.length === 0) {
    return {
      items: null,
      rationale: null,
      calls: outcome.calls,
      failure: 'invalid_output',
      reason: 'ни один пункт не прошёл сверку с кандидатами',
      rejected,
    };
  }

  return {
    items,
    rationale: outcome.data.rationale,
    calls: outcome.calls,
    failure: null,
    reason: null,
    rejected,
  };
}
