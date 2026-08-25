import type { LessonOutlineStep } from '../../contracts/ai/roadmap.js';
import type { SqlExecutor } from '../../db/sql.js';
import { MAX_NODES, orderTopics } from '../../domain/roadmap.js';
import type { PlannedNode } from '../../ai/ops/roadmap-plan.js';
import {
  loadPlannableTopics,
  storeRoadmap,
  syncRoadmapStates,
  type PlannableRow,
  type StoredRoadmap,
} from './queries.js';

export function defaultOutline(topicTitle: string): LessonOutlineStep[] {
  return [
    { step: 1, kind: 'intro', title: 'С чего начать' },
    { step: 2, kind: 'theory', title: topicTitle },
    { step: 3, kind: 'practice', title: 'Проверка знаний' },
  ];
}

export interface BuildInput {
  readonly studentId: string;
  readonly subjectId: string;
  readonly aiJobId: string | null;
  readonly replanReason: string | null;
  
  readonly proposal: readonly PlannedNode[] | null;
  
  readonly topics?: readonly PlannableRow[];
}

export interface BuildResult extends StoredRoadmap {
  readonly source: 'ai' | 'fallback';
  readonly topicsAvailable: number;
}

export async function buildRoadmap(
  sql: SqlExecutor,
  input: BuildInput,
  scope: { readonly gradeMin: number; readonly gradeMax: number },
): Promise<BuildResult | null> {
  const topics =
    input.topics ??
    (await loadPlannableTopics(
      sql,
      input.studentId,
      input.subjectId,
      scope.gradeMin,
      scope.gradeMax,
    ));

  if (topics.length === 0) {
    return null;
  }

  const byTopic = new Map(topics.map((topic) => [topic.topicId, topic]));
  const nodes =
    input.proposal === null
      ? fallbackNodes(topics)
      : proposedNodes(input.proposal, byTopic);

  const stored = await storeRoadmap(sql, {
    studentId: input.studentId,
    subjectId: input.subjectId,
    aiJobId: input.aiJobId,
    replanReason: input.replanReason,
    nodes,
  });

  
  
  
  await syncRoadmapStates(sql, input.studentId, stored.roadmapId);

  return {
    ...stored,
    source: input.proposal === null ? 'fallback' : 'ai',
    topicsAvailable: topics.length,
  };
}

function fallbackNodes(topics: readonly PlannableRow[]): {
  position: number;
  topicId: string;
  lessonId: string | null;
  materialId: string | null;
  title: string;
  outline: LessonOutlineStep[];
  rationale: string | null;
}[] {
  return orderTopics(
    topics.map((topic) => ({
      topicId: topic.topicId,
      title: topic.title,
      prerequisiteIds: topic.prerequisiteIds,
      priority: topic.priority,
      sortOrder: topic.sortOrder,
    })),
  ).map((topic, index) => {
    const row = topics.find((candidate) => candidate.topicId === topic.topicId);
    return {
      position: index + 1,
      topicId: topic.topicId,
      lessonId: row?.defaultLessonId ?? null,
      materialId: row?.defaultMaterialId ?? null,
      title: topic.title,
      outline: defaultOutline(topic.title),
      rationale: null,
    };
  });
}

function proposedNodes(
  proposal: readonly PlannedNode[],
  byTopic: ReadonlyMap<string, PlannableRow>,
): {
  position: number;
  topicId: string;
  lessonId: string | null;
  materialId: string | null;
  title: string;
  outline: LessonOutlineStep[];
  rationale: string | null;
}[] {
  return proposal.slice(0, MAX_NODES).map((node, index) => {
    const row = byTopic.get(node.topicId);
    return {
      position: index + 1,
      topicId: node.topicId,
      lessonId: row?.defaultLessonId ?? null,
      materialId: node.materialId ?? row?.defaultMaterialId ?? null,
      title: node.title,
      outline: [...node.outline],
      rationale: node.rationale === '' ? null : node.rationale,
    };
  });
}
