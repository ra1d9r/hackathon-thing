import {
  DAILY_ITEMS as DAILY_ITEMS_LIMIT,
  isProblemTopic,
  masteryStatus,
  MAX_DAILY_ITEMS as MAX_DAILY_ITEMS_LIMIT,
} from '../contracts/domain.js';

export const DAILY_ITEMS = DAILY_ITEMS_LIMIT;
export const MAX_DAILY_ITEMS = MAX_DAILY_ITEMS_LIMIT;

export type DailyItemKind = 'task' | 'lesson' | 'review';

export interface StreakState {
  readonly current: number;
  readonly longest: number;
  
  readonly lastCompletedDate: string | null;
}

export function previousDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) - 1));
  return shifted.toISOString().slice(0, 10);
}

export function advanceStreak(state: StreakState, planDate: string): StreakState {
  if (state.lastCompletedDate === planDate) {
    return state;
  }

  
  
  
  const current = state.lastCompletedDate === previousDate(planDate) ? state.current + 1 : 1;

  return {
    current,
    longest: Math.max(state.longest, current),
    lastCompletedDate: planDate,
  };
}

export interface DailyCandidate {
  readonly topicId: string;
  readonly subjectId: string;
  readonly title: string;
  readonly masteryPct: number;
  readonly priority: number;
  
  readonly lessonId: string | null;
  
  readonly nodePosition: number | null;
  
  readonly nodeAvailable: boolean;
  
  readonly daysSincePractice: number | null;
}

export interface PlannedItem {
  readonly position: number;
  readonly kind: DailyItemKind;
  readonly topicId: string;
  readonly subjectId: string;
  readonly title: string;
  readonly lessonId: string;
  readonly estMinutes: number;
}

export const ITEM_MINUTES: Record<DailyItemKind, number> = {
  task: 20,
  lesson: 30,
  review: 15,
};

export function planDailyItems(
  candidates: readonly DailyCandidate[],
  limit = DAILY_ITEMS,
): PlannedItem[] {
  const usable = candidates.filter(
    (candidate): candidate is DailyCandidate & { lessonId: string } => candidate.lessonId !== null,
  );

  const taken = new Set<string>();
  const picked: { candidate: DailyCandidate & { lessonId: string }; kind: DailyItemKind }[] = [];

  const take = (
    kind: DailyItemKind,
    choose: (pool: (DailyCandidate & { lessonId: string })[]) => (DailyCandidate & { lessonId: string }) | undefined,
  ): void => {
    if (picked.length >= limit) {
      return;
    }
    const candidate = choose(usable.filter((item) => !taken.has(item.topicId)));
    if (candidate !== undefined) {
      taken.add(candidate.topicId);
      picked.push({ candidate, kind });
    }
  };

  
  take('task', (pool) => {
    const problems = pool.filter((item) => isProblemTopic(item.masteryPct));
    return [...problems].sort(byPriority)[0];
  });

  
  take('lesson', (pool) => {
    const inRoadmap = pool.filter((item) => item.nodeAvailable && item.nodePosition !== null);
    return [...inRoadmap].sort((a, b) => (a.nodePosition ?? 0) - (b.nodePosition ?? 0))[0];
  });

  
  take('review', (pool) => {
    const strong = pool.filter((item) => {
      const status = masteryStatus(item.masteryPct);
      return status === 'strong' || status === 'mastered';
    });
    return [...strong].sort(byStaleness)[0];
  });

  
  
  while (picked.length < limit) {
    const rest = usable.filter((item) => !taken.has(item.topicId));
    const next = [...rest].sort(byPriority)[0];
    if (next === undefined) {
      break;
    }
    taken.add(next.topicId);
    picked.push({ candidate: next, kind: isProblemTopic(next.masteryPct) ? 'task' : 'review' });
  }

  return picked.map((item, index) => ({
    position: index + 1,
    kind: item.kind,
    topicId: item.candidate.topicId,
    subjectId: item.candidate.subjectId,
    title: item.candidate.title,
    lessonId: item.candidate.lessonId,
    estMinutes: ITEM_MINUTES[item.kind],
  }));
}

function byPriority(a: DailyCandidate, b: DailyCandidate): number {
  return b.priority - a.priority || a.masteryPct - b.masteryPct || a.topicId.localeCompare(b.topicId);
}

function byStaleness(a: DailyCandidate, b: DailyCandidate): number {
  const left = a.daysSincePractice ?? Number.MAX_SAFE_INTEGER;
  const right = b.daysSincePractice ?? Number.MAX_SAFE_INTEGER;
  return right - left || a.topicId.localeCompare(b.topicId);
}

export function itemMeta(estMinutes: number, questionCount: number | null): string {
  const minutes = `${estMinutes} мин`;
  return questionCount === null ? minutes : `${minutes} • ${questionCount} ${plural(questionCount)}`;
}

function plural(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) {
    return 'вопросов';
  }
  if (mod10 === 1) {
    return 'вопрос';
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return 'вопроса';
  }
  return 'вопросов';
}
