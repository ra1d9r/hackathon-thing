import {
  clamp,
  MAX_ROADMAP_NODES,
  MIN_ROADMAP_NODES,
  roundTo,
} from '../contracts/domain.js';

export const MIN_NODES = MIN_ROADMAP_NODES;
export const MAX_NODES = MAX_ROADMAP_NODES;

export const MATERIAL_WEIGHT_PCT = 30;
export const CHECK_WEIGHT_PCT = 100 - MATERIAL_WEIGHT_PCT;

export const COMPLETE_CHECK_PCT = 80;

export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'completed';

export interface NodeProgressInput {
  
  readonly materialRead: boolean;
  
  readonly bestCheckPct: number | null;
}

export interface NodeProgress {
  readonly progressPct: number;
  readonly completed: boolean;
}

export function nodeProgress(input: NodeProgressInput): NodeProgress {
  const checkPct = input.bestCheckPct === null ? 0 : clamp(input.bestCheckPct, 0, 100);
  const progress =
    (input.materialRead ? MATERIAL_WEIGHT_PCT : 0) + (CHECK_WEIGHT_PCT * checkPct) / 100;

  const progressPct = roundTo(clamp(progress, 0, 100), 2);
  const completed = progressPct >= 100 || (input.materialRead && checkPct >= COMPLETE_CHECK_PCT);

  return { progressPct, completed };
}

export interface NodeStatusInput extends NodeProgressInput {
  
  readonly prerequisitesMet: boolean;
}

export function nodeStatus(input: NodeStatusInput): NodeStatus {
  const { progressPct, completed } = nodeProgress(input);

  if (completed) {
    return 'completed';
  }
  if (!input.prerequisitesMet) {
    
    
    return progressPct > 0 ? 'in_progress' : 'locked';
  }

  return progressPct > 0 ? 'in_progress' : 'available';
}

export function overallProgressPct(nodes: readonly { readonly progressPct: number }[]): number {
  if (nodes.length === 0) {
    return 0;
  }

  const sum = nodes.reduce((total, node) => total + node.progressPct, 0);
  return roundTo(clamp(sum / nodes.length, 0, 100), 2);
}

export interface PlannableTopic {
  readonly topicId: string;
  readonly title: string;
  
  readonly prerequisiteIds: readonly string[];
  
  readonly priority: number;
  
  readonly sortOrder: number;
}

export function orderTopics(topics: readonly PlannableTopic[]): PlannableTopic[] {
  const byId = new Map(topics.map((topic) => [topic.topicId, topic]));
  const placed = new Set<string>();
  const ordered: PlannableTopic[] = [];

  const rank = (a: PlannableTopic, b: PlannableTopic): number =>
    b.priority - a.priority || a.sortOrder - b.sortOrder || a.topicId.localeCompare(b.topicId);

  let remaining = [...topics];

  while (remaining.length > 0) {
    const ready = remaining.filter((topic) =>
      topic.prerequisiteIds.every((id) => !byId.has(id) || placed.has(id)),
    );

    if (ready.length === 0) {
      
      ordered.push(...[...remaining].sort((a, b) => a.sortOrder - b.sortOrder));
      break;
    }

    ready.sort(rank);
    for (const topic of ready) {
      ordered.push(topic);
      placed.add(topic.topicId);
    }

    remaining = remaining.filter((topic) => !placed.has(topic.topicId));
  }

  return ordered.slice(0, MAX_NODES);
}

export interface UnlockInput {
  readonly topicId: string;
  readonly position: number;
  readonly prerequisiteIds: readonly string[];
  readonly materialRead: boolean;
  readonly bestCheckPct: number | null;
}

export interface UnlockedNode {
  readonly topicId: string;
  readonly position: number;
  readonly status: NodeStatus;
  readonly progressPct: number;
  readonly completed: boolean;
}

export function unlockNodes(nodes: readonly UnlockInput[]): UnlockedNode[] {
  const inPlan = new Set(nodes.map((node) => node.topicId));
  const byPosition = [...nodes].sort((a, b) => a.position - b.position);

  const completedTopics = new Set<string>();
  for (const node of byPosition) {
    if (nodeProgress(node).completed) {
      completedTopics.add(node.topicId);
    }
  }

  return byPosition.map((node, index) => {
    const prerequisitesMet =
      index === 0 ||
      node.prerequisiteIds.every((id) => !inPlan.has(id) || completedTopics.has(id));

    const { progressPct, completed } = nodeProgress(node);

    return {
      topicId: node.topicId,
      position: node.position,
      status: nodeStatus({ ...node, prerequisitesMet }),
      progressPct,
      completed,
    };
  });
}

export const REPLAN_WINDOW_MS = 6 * 60 * 60 * 1000;

export function replanBucket(now: Date = new Date()): number {
  return Math.floor(now.getTime() / REPLAN_WINDOW_MS);
}

export const FAILED_ATTEMPTS_BEFORE_REPLAN = 3;
