import {
  diagnosticAnalysisEnvelopeSchema,
  diagnosticAnalysisSchema,
  masteryUpdateEnvelopeSchema,
  masteryUpdateSchema,
} from '../../contracts/ai/analysis.js';
import { toResponseSchema } from '../../contracts/ai/envelope.js';
import { clamp, roundTo } from '../../contracts/domain.js';
import type { JsonValue } from '../../contracts/json.js';
import { clampAiDelta, type TopicDelta } from '../../domain/mastery.js';
import type { SqlExecutor } from '../../db/sql.js';
import {
  buildCurriculumSnapshot,
  curriculumBlock,
  operationBlock,
  schemaBlock,
  studentBlock,
  systemCoreBlock,
} from '../prompt.js';
import { callAndValidate, type CallLogEntry, type ModelFailureReason } from '../validate.js';
import type { AiOpType } from '../../queue/jobs.js';
import type { ModelCaller, PromptBlock, ResponseSchema } from '../types.js';

const TEMPERATURE = 0;

const MAX_TOKENS = 16_000;

const DIAGNOSTIC_SCHEMA = toResponseSchema(diagnosticAnalysisSchema, 'diagnostic_analysis');
const MASTERY_SCHEMA = toResponseSchema(masteryUpdateSchema, 'mastery_update');

export interface AnalysisTopicInput {
  readonly topicId: string;
  readonly subjectId: string;
  readonly title: string;
  readonly pointsEarned: number;
  readonly pointsPossible: number;
  readonly observedPct: number;
  readonly currentMasteryPct: number | null;
  readonly deterministicDeltaPct: number;
}

export interface AnalysisProposal {
  readonly topicId: string;
  readonly deltaPct: number;
  readonly reason: string;
  readonly confidence: number;
}

const HIGHLIGHTS_KEPT = 3;

export interface TopicHighlight {
  readonly topicId: string;
  readonly note: string;
}

export interface AnalysisOutcome {
  readonly proposals: readonly AnalysisProposal[] | null;
  readonly summaryMd: string | null;
  readonly strengths: readonly TopicHighlight[];
  readonly weaknesses: readonly TopicHighlight[];
  readonly calls: readonly CallLogEntry[];
  readonly failure: ModelFailureReason | null;
  readonly reason: string | null;
  readonly repairedBecause: string | null;
  readonly clampedCount: number;
}

function keepKnown(
  items: readonly { topic_id: string; note: string }[],
  known: ReadonlySet<string>,
): TopicHighlight[] {
  const seen = new Set<string>();

  return items
    .flatMap((item) => {
      if (!known.has(item.topic_id) || seen.has(item.topic_id)) {
        return [];
      }
      seen.add(item.topic_id);
      return [{ topicId: item.topic_id, note: item.note }];
    })
    .slice(0, HIGHLIGHTS_KEPT);
}

function topicPayload(topics: readonly AnalysisTopicInput[]): JsonValue {
  return {
    topics: topics.map((topic) => ({
      topic_id: topic.topicId,
      subject_id: topic.subjectId,
      points_earned: topic.pointsEarned,
      points_possible: topic.pointsPossible,
      observed_pct: topic.observedPct,
      current_mastery_pct: topic.currentMasteryPct,
    })),
  };
}

async function buildBlocks(
  sql: SqlExecutor,
  topics: readonly AnalysisTopicInput[],
  isDiagnostic: boolean,
  schema: ResponseSchema,
): Promise<PromptBlock[]> {
  const snapshot = await buildCurriculumSnapshot(
    sql,
    topics.map((topic) => topic.topicId),
  );

  const instruction = isDiagnostic
    ? [
        'ЗАДАЧА: разбери результат диагностического теста.',
        '',
        'Это первый замер, поэтому для каждой темы укажи стартовое мастерство',
        'в процентах (mastery_pct), а не сдвиг. Опирайся на долю набранных баллов',
        'и на то, насколько показательна выборка: одна задача по теме — слабое',
        'свидетельство, четыре — уверенное.',
        '',
        'Отдельно назови не более трёх сильных сторон и не более трёх тем,',
        'требующих внимания. В note пиши, что ученик умеет или чего ему не хватает,',
        'а не пересказ балла: «уверенно применяет формулу вершины» — годится,',
        '«верно выполнено задание» — нет.',
        '',
        'И напиши краткий разбор для ученика (summary_md, до 1200 символов).',
      ]
    : [
        'ЗАДАЧА: разбери результат попытки и предложи изменение мастерства.',
        '',
        'Для каждой темы верни сдвиг в процентных пунктах (delta_pct).',
        'Учитывай накопленное значение: подтверждение уже освоенной темы',
        'двигает оценку слабее, чем первое свидетельство.',
        '',
        'Напиши краткий разбор для ученика (summary_md).',
      ];

  return [
    systemCoreBlock(),
    schemaBlock(schema),
    curriculumBlock(snapshot),
    studentBlock(topicPayload(topics)),
    operationBlock(
      [
        ...instruction,
        '',
        'Идентификаторы тем бери из блока CURRICULUM дословно.',
        'Тем, которых нет в списке, в ответе быть не должно.',
        '',
        'reason по каждой теме — одно короткое предложение, не длиннее 120 символов.',
        'Ответ должен быть компактным: длинные рассуждения тратят бюджет впустую.',
      ].join('\n'),
    ),
  ];
}

export async function proposeMasteryChanges(
  sql: SqlExecutor,
  caller: ModelCaller,
  topics: readonly AnalysisTopicInput[],
  options: { readonly isDiagnostic: boolean; readonly opType: AiOpType },
): Promise<AnalysisOutcome> {
  if (topics.length === 0) {
    return {
      proposals: [],
      summaryMd: null,
      strengths: [],
      weaknesses: [],
      calls: [],
      failure: null,
      reason: null,
      repairedBecause: null,
      clampedCount: 0,
    };
  }

  const schema = options.isDiagnostic ? DIAGNOSTIC_SCHEMA : MASTERY_SCHEMA;
  const blocks = await buildBlocks(sql, topics, options.isDiagnostic, schema);
  const known = new Map(topics.map((topic) => [topic.topicId, topic]));
  const knownIds = new Set(known.keys());

  if (options.isDiagnostic) {
    const outcome = await callAndValidate({
      caller,
      schema: diagnosticAnalysisEnvelopeSchema,
      request: {
        opType: options.opType,
        blocks,
        schema,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
      },
    });

    if (!outcome.ok) {
      return {
        proposals: null,
        summaryMd: null,
        strengths: [],
        weaknesses: [],
        calls: outcome.calls,
        failure: outcome.reason,
        reason: outcome.message,
        repairedBecause: null,
        clampedCount: 0,
      };
    }

    const proposals: AnalysisProposal[] = [];
    const seen = new Set<string>();
    let clampedCount = 0;

    for (const estimate of outcome.data.mastery_estimates) {
      const topic = known.get(estimate.topic_id);
      if (topic === undefined || seen.has(estimate.topic_id)) {
        continue;
      }
      seen.add(estimate.topic_id);

      const base = topic.currentMasteryPct ?? topic.observedPct;
      const proposed = clamp(estimate.mastery_pct, 0, 100) - base;
      const applied = clampAiDelta(proposed, topic.deterministicDeltaPct);

      if (applied !== roundTo(proposed, 2)) {
        clampedCount += 1;
      }

      proposals.push({
        topicId: topic.topicId,
        deltaPct: applied,
        reason: estimate.reason,
        confidence: estimate.confidence,
      });
    }

    return {
      proposals,
      summaryMd: outcome.data.summary_md,
      strengths: keepKnown(outcome.data.strengths, knownIds),
      weaknesses: keepKnown(outcome.data.weaknesses, knownIds),
      calls: outcome.calls,
      failure: null,
      reason: null,
      repairedBecause: outcome.repairedBecause,
      clampedCount,
    };
  }

  const outcome = await callAndValidate({
    caller,
    schema: masteryUpdateEnvelopeSchema,
    request: {
      opType: options.opType,
      blocks,
      schema,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    },
  });

  if (!outcome.ok) {
    return {
      proposals: null,
      summaryMd: null,
      strengths: [],
      weaknesses: [],
      calls: outcome.calls,
      failure: outcome.reason,
      reason: outcome.message,
      repairedBecause: null,
      clampedCount: 0,
    };
  }

  const proposals: AnalysisProposal[] = [];
  const seen = new Set<string>();
  let clampedCount = 0;

  for (const update of outcome.data.updates) {
    const topic = known.get(update.topic_id);
    if (topic === undefined || seen.has(update.topic_id)) {
      continue;
    }
    seen.add(update.topic_id);

    const applied = clampAiDelta(update.delta_pct, topic.deterministicDeltaPct);
    if (applied !== roundTo(update.delta_pct, 2)) {
      clampedCount += 1;
    }

    proposals.push({
      topicId: topic.topicId,
      deltaPct: applied,
      reason: update.reason,
      confidence: update.confidence,
    });
  }

  return {
    proposals,
    summaryMd: outcome.data.summary_md,
    strengths: [],
    weaknesses: [],
    calls: outcome.calls,
    failure: null,
    reason: null,
    repairedBecause: outcome.repairedBecause,
    clampedCount,
  };
}

export function mergeProposals(
  deterministic: readonly TopicDelta[],
  proposals: readonly AnalysisProposal[] | null,
): TopicDelta[] {
  if (proposals === null) {
    return [...deterministic];
  }

  const byTopic = new Map(proposals.map((proposal) => [proposal.topicId, proposal]));

  return deterministic.map((delta) => {
    const proposal = byTopic.get(delta.topicId);
    return proposal === undefined ? delta : { ...delta, deltaPct: proposal.deltaPct };
  });
}
