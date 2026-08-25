import { createHash } from 'node:crypto';

export const FOCUS_SIZE = 3;

export const FATIGUE_DECAY = 0.5;

export interface FocusCandidate {
  readonly topicId: string;
  readonly priority: number;
  
  readonly focusFatigue: number;
}

export interface FocusPick {
  readonly topicId: string;
  readonly weight: number;
}

export function deterministicRandom(studentId: string, topicId: string, planDate: string): number {
  const digest = createHash('sha256').update(`${studentId}:${topicId}:${planDate}`).digest();
  
  return digest.readUInt32BE(0) / 2 ** 32;
}

function weightOf(candidate: FocusCandidate): number {
  return candidate.priority * FATIGUE_DECAY ** candidate.focusFatigue;
}

export function pickFocus(
  candidates: readonly FocusCandidate[],
  studentId: string,
  planDate: string,
  size = FOCUS_SIZE,
): FocusPick[] {
  const scored = candidates
    .map((candidate) => {
      const weight = weightOf(candidate);
      const random = deterministicRandom(studentId, candidate.topicId, planDate);

      
      
      const key = weight <= 0 ? -1 : random ** (1 / weight);

      return { topicId: candidate.topicId, weight, key };
    })
    .filter((item) => item.key >= 0);

  scored.sort((left, right) => {
    const diff = right.key - left.key;
    
    
    return diff !== 0 ? diff : left.topicId.localeCompare(right.topicId);
  });

  return scored.slice(0, size).map((item) => ({ topicId: item.topicId, weight: item.weight }));
}

export function nextFatigue(
  current: number,
  lastFocusDate: string | null,
  planDate: string,
  picked: boolean,
): number {
  if (!picked) {
    return 0;
  }

  const isConsecutive = lastFocusDate !== null && isPreviousDay(lastFocusDate, planDate);
  return isConsecutive ? Math.min(current + 1, 30) : 1;
}

function isPreviousDay(earlier: string, later: string): boolean {
  const earlierMs = Date.parse(`${earlier}T00:00:00Z`);
  const laterMs = Date.parse(`${later}T00:00:00Z`);

  if (Number.isNaN(earlierMs) || Number.isNaN(laterMs)) {
    return false;
  }

  return laterMs - earlierMs === 86_400_000;
}
