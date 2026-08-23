import {
  predictedScoreEnvelopeSchema,
  predictedScoreSchema,
} from '../../contracts/ai/predicted-score.js';
import { toResponseSchema } from '../../contracts/ai/envelope.js';
import type { ScaleKind } from '../../contracts/domain.js';
import type { JsonValue } from '../../contracts/json.js';
import { clampAiScore, type SectionEstimate } from '../../domain/predicted-score.js';
import { operationBlock, schemaBlock, studentBlock, systemCoreBlock } from '../prompt.js';
import { callAndValidate, type CallLogEntry, type ModelFailureReason } from '../validate.js';
import type { ModelCaller } from '../types.js';

const TEMPERATURE = 0;
const MAX_TOKENS = 6_000;

const RESPONSE_SCHEMA = toResponseSchema(predictedScoreSchema, 'predicted_score');

export interface ScoreContext {
  readonly scale: ScaleKind;
  readonly examTitle: string | null;
  readonly maxScore: number;
  readonly baselineValue: number;
  readonly sections: readonly SectionEstimate[];
  readonly history: readonly { readonly at: string; readonly value: number }[];
  readonly daysLeft: number | null;
}

export interface ScoreOutcome {
  readonly value: number | null;
  readonly confidence: number | null;
  readonly rationale: string | null;
  readonly breakdown: readonly {
    readonly subjectId: string;
    readonly expectedPoints: number;
    readonly maxPoints: number;
    readonly note: string;
  }[];
  readonly calls: readonly CallLogEntry[];
  readonly failure: ModelFailureReason | null;
  readonly reason: string | null;
  readonly clamped: boolean;
}

function contextPayload(context: ScoreContext): JsonValue {
  return {
    scale: context.scale,
    max_score: context.maxScore,
    baseline_value: context.baselineValue,
    days_left: context.daysLeft,
    sections: context.sections.map((section) => ({
      subject_id: section.subjectId,
      slot_kind: section.slotKind,
      mastery_pct: section.masteryPct,
      max_points: section.maxPoints,
      baseline_points: section.points,
    })),
    history: context.history.map((point) => ({ at: point.at, value: point.value })),
  };
}

export async function proposePredictedScore(
  caller: ModelCaller,
  context: ScoreContext,
): Promise<ScoreOutcome> {
  const tolerance = Math.round(context.maxScore * 0.1);

  const blocks = [
    systemCoreBlock(),
    schemaBlock(RESPONSE_SCHEMA),
    studentBlock(contextPayload(context)),
    operationBlock(
      [
        'ЗАДАЧА: оцени, сколько ученик наберёт на выбранной цели.',
        '',
        `Шкала: ${context.scale === 'points' ? `баллы, максимум ${context.maxScore}` : 'оценка от 1 до 10'}.`,
        context.examTitle === null ? '' : `Экзамен: ${context.examTitle}.`,
        '',
        'В блоке STUDENT_CONTEXT — расчёт системы по чертежу экзамена',
        `(baseline_value = ${context.baselineValue}) и разбивка по секциям.`,
        'Твоя оценка может отличаться от него не более чем на ' +
          `${tolerance} — большее расхождение система всё равно прижмёт к этой границе.`,
        '',
        'Учитывай динамику по history: устойчивый рост — повод для оценки выше',
        'расчёта, спад — ниже. Если истории нет, держись расчёта.',
        '',
        'В breakdown укажи ожидаемые баллы по каждой секции с subject_id',
        'и коротким пояснением. Секции без subject_id пропусти.',
        'В rationale — 2–4 предложения для ученика: на чём держится оценка',
        'и что даст наибольшую прибавку.',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    ),
  ];

  const outcome = await callAndValidate({
    caller,
    schema: predictedScoreEnvelopeSchema,
    request: {
      opType: 'predicted_score',
      blocks,
      schema: RESPONSE_SCHEMA,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    },
  });

  if (!outcome.ok) {
    return {
      value: null,
      confidence: null,
      rationale: null,
      breakdown: [],
      calls: outcome.calls,
      failure: outcome.reason,
      reason: outcome.message,
      clamped: false,
    };
  }

  const applied = clampAiScore(outcome.data.value, context.baselineValue, context.maxScore);
  const known = new Set(
    context.sections
      .map((section) => section.subjectId)
      .filter((subjectId): subjectId is string => subjectId !== null),
  );

  return {
    value: applied,
    confidence: outcome.data.confidence,
    rationale: outcome.data.rationale,
    breakdown: outcome.data.breakdown
      .filter((item) => known.has(item.subject_id))
      .map((item) => ({
        subjectId: item.subject_id,
        expectedPoints: item.expected_points,
        maxPoints: item.max_points,
        note: item.note,
      })),
    calls: outcome.calls,
    failure: null,
    reason: null,
    clamped: applied !== outcome.data.value,
  };
}
