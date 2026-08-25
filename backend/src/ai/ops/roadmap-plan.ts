import {
  roadmapPlanEnvelopeSchema,
  roadmapPlanSchema,
  type LessonOutlineStep,
} from '../../contracts/ai/roadmap.js';
import { toResponseSchema } from '../../contracts/ai/envelope.js';
import type { JsonValue } from '../../contracts/json.js';
import { MAX_NODES } from '../../domain/roadmap.js';
import { operationBlock, schemaBlock, scopeBlock, studentBlock, systemCoreBlock } from '../prompt.js';
import { callAndValidate, type CallLogEntry, type ModelFailureReason } from '../validate.js';
import type { ModelCaller } from '../types.js';

const TEMPERATURE = 0.2;
const MAX_TOKENS = 12_000;

const RESPONSE_SCHEMA = toResponseSchema(roadmapPlanSchema, 'roadmap_plan');

export interface PlannableTopicContext {
  readonly topicId: string;
  readonly title: string;
  readonly gradeMin: number;
  readonly gradeMax: number;
  readonly masteryPct: number | null;
  readonly priority: number;
  readonly prerequisiteIds: readonly string[];
  
  readonly materialIds: readonly string[];
}

export interface RoadmapContext {
  readonly subjectName: string;
  readonly scope: { readonly gradeMin: number; readonly gradeMax: number; readonly reason: string };
  readonly goalTitle: string;
  readonly topics: readonly PlannableTopicContext[];
  
  readonly replanReason: string | null;
}

export interface PlannedNode {
  readonly position: number;
  readonly topicId: string;
  readonly materialId: string | null;
  readonly title: string;
  readonly outline: readonly LessonOutlineStep[];
  readonly rationale: string;
}

export interface RoadmapOutcome {
  
  readonly nodes: readonly PlannedNode[] | null;
  readonly replanReason: string | null;
  readonly calls: readonly CallLogEntry[];
  readonly failure: ModelFailureReason | null;
  readonly reason: string | null;
  
  readonly rejected: number;
}

function contextPayload(context: RoadmapContext): JsonValue {
  return {
    subject: context.subjectName,
    goal: context.goalTitle,
    replan_reason: context.replanReason,
    topics: context.topics.map((topic) => ({
      topic_id: topic.topicId,
      title: topic.title,
      grades: [topic.gradeMin, topic.gradeMax],
      mastery_pct: topic.masteryPct,
      priority: topic.priority,
      prerequisite_ids: [...topic.prerequisiteIds],
      material_ids: [...topic.materialIds],
    })),
  };
}

export async function proposeRoadmap(
  caller: ModelCaller,
  context: RoadmapContext,
): Promise<RoadmapOutcome> {
  const limit = Math.min(context.topics.length, MAX_NODES);

  const blocks = [
    systemCoreBlock(),
    schemaBlock(RESPONSE_SCHEMA),
    scopeBlock(context.scope, [context.subjectName]),
    studentBlock(contextPayload(context)),
    operationBlock(
      [
        `ЗАДАЧА: составь дорожную карту по предмету «${context.subjectName}».`,
        '',
        'В STUDENT_CONTEXT — темы, доступные этому ученику: мастерство в процентах',
        '(null — не измерялось), приоритет (больше — нужнее сейчас), пререквизиты',
        'и материалы, которые к теме относятся.',
        '',
        'Правила, нарушение которых система исправит сама, отбросив твой ответ:',
        `1. topic_id — только из списка выше. Не придумывай новые.`,
        '2. material_id — только из material_ids той же темы, иначе null.',
        '3. Тема не повторяется, позиции идут подряд с 1.',
        `4. Узлов не больше ${limit}.`,
        '5. Тема идёт после своих пререквизитов, если те тоже попали в план.',
        '',
        'Порядок выбирай по смыслу: слабые темы с высоким приоритетом — раньше,',
        'но не в ущерб последовательности изложения. Тема, которую нельзя понять',
        'без предыдущей, идёт после неё, даже если приоритет у неё ниже.',
        '',
        'outline — состав урока из 3–5 шагов: интро, теория, практика, итог.',
        'Заголовки шагов пиши по теме, а не общими словами: «Разбор формул',
        'приведения», а не «Теория».',
        '',
        'rationale — одно предложение для ученика, почему тема стоит здесь.',
        context.replanReason === null
          ? 'replan_reason — «первое построение».'
          : `replan_reason — коротко объясни перестановку. Причина переплана: ${context.replanReason}.`,
      ].join('\n'),
    ),
  ];

  const outcome = await callAndValidate({
    caller,
    schema: roadmapPlanEnvelopeSchema,
    request: {
      opType: 'roadmap_plan',
      blocks,
      schema: RESPONSE_SCHEMA,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    },
  });

  if (!outcome.ok) {
    return {
      nodes: null,
      replanReason: null,
      calls: outcome.calls,
      failure: outcome.reason,
      reason: outcome.message,
      rejected: 0,
    };
  }

  const allowedTopics = new Map(context.topics.map((topic) => [topic.topicId, topic]));
  const seenTopics = new Set<string>();
  const nodes: PlannedNode[] = [];
  let rejected = 0;

  
  
  
  for (const node of [...outcome.data.nodes].sort((a, b) => a.position - b.position)) {
    const topic = allowedTopics.get(node.topic_id);
    if (topic === undefined || seenTopics.has(node.topic_id)) {
      rejected += 1;
      continue;
    }

    seenTopics.add(node.topic_id);
    nodes.push({
      
      
      position: nodes.length + 1,
      topicId: node.topic_id,
      
      
      materialId:
        node.material_id !== null && topic.materialIds.includes(node.material_id)
          ? node.material_id
          : null,
      title: node.title,
      outline: node.outline,
      rationale: node.rationale,
    });

    if (nodes.length >= limit) {
      break;
    }
  }

  if (nodes.length === 0) {
    return {
      nodes: null,
      replanReason: null,
      calls: outcome.calls,
      failure: 'invalid_output',
      reason: 'ни один узел не прошёл сверку с каталогом',
      rejected,
    };
  }

  return {
    nodes,
    replanReason: outcome.data.replan_reason,
    calls: outcome.calls,
    failure: null,
    reason: null,
    rejected,
  };
}
