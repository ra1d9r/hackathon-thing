import { clamp, roundTo } from '../contracts/domain.js';




export const CONVERGENCE_K = 0.5;


export const DELTA_LIMIT_PCT = 25;


export const FULL_EVIDENCE_POINTS = 4;


const MIN_EVIDENCE_WEIGHT = 0.01;


export const NEUTRAL_BASELINE_PCT = 50;


export function baselineFromObservation(observed: number, weight: number): number {
  const trust = clamp(weight, 0, 1);
  return roundTo(observed * trust + NEUTRAL_BASELINE_PCT * (1 - trust), 2);
}

export interface TopicOutcome {
  readonly topicId: string;
  readonly subjectId: string;
  
  readonly pointsPossible: number;
  readonly pointsEarned: number;
  readonly questionsGraded: number;
  
  readonly trust?: number;
}

export interface TopicDelta {
  readonly topicId: string;
  readonly subjectId: string;
  readonly observedPct: number;
  readonly deltaPct: number;
  readonly evidenceWeight: number;
  
  readonly baselinePct: number | null;
}


export function evidenceWeight(pointsPossible: number, trust = 1): number {
  const weight = clamp(pointsPossible / FULL_EVIDENCE_POINTS, 0, 1) * clamp(trust, 0, 1);
  return roundTo(Math.max(MIN_EVIDENCE_WEIGHT, weight), 2);
}


export function observedPct(outcome: TopicOutcome): number {
  if (outcome.pointsPossible <= 0) {
    return 0;
  }
  return roundTo(clamp((outcome.pointsEarned / outcome.pointsPossible) * 100, 0, 100), 2);
}

export interface DeltaOptions {
  
  readonly currentMastery: ReadonlyMap<string, number>;
  
  readonly baselineFromObserved?: boolean;
}


export function computeTopicDelta(outcome: TopicOutcome, options: DeltaOptions): TopicDelta {
  const observed = observedPct(outcome);
  const weight = evidenceWeight(outcome.pointsPossible, outcome.trust);
  const known = options.currentMastery.get(outcome.topicId);
  const isFirstEvidence = known === undefined;

  
  
  if (isFirstEvidence && options.baselineFromObserved === true) {
    return {
      topicId: outcome.topicId,
      subjectId: outcome.subjectId,
      observedPct: observed,
      deltaPct: 0,
      evidenceWeight: weight,
      baselinePct: baselineFromObservation(observed, weight),
    };
  }

  const reference = known ?? 0;

  const delta = roundTo(
    clamp((observed - reference) * CONVERGENCE_K * weight, -DELTA_LIMIT_PCT, DELTA_LIMIT_PCT),
    2,
  );

  return {
    topicId: outcome.topicId,
    subjectId: outcome.subjectId,
    observedPct: observed,
    deltaPct: delta,
    evidenceWeight: weight,
    baselinePct: null,
  };
}

export function computeTopicDeltas(
  outcomes: readonly TopicOutcome[],
  options: DeltaOptions,
): TopicDelta[] {
  return outcomes
    .filter((outcome) => outcome.pointsPossible > 0)
    .map((outcome) => computeTopicDelta(outcome, options));
}


export const AI_DELTA_TOLERANCE_PCT = 10;

export function clampAiDelta(aiDelta: number, deterministicDelta: number): number {
  return roundTo(
    clamp(
      aiDelta,
      Math.max(-DELTA_LIMIT_PCT, deterministicDelta - AI_DELTA_TOLERANCE_PCT),
      Math.min(DELTA_LIMIT_PCT, deterministicDelta + AI_DELTA_TOLERANCE_PCT),
    ),
    2,
  );
}


export const DAILY_GROWTH_CAP_PCT = 60;


export function capDailyGrowth(
  deltas: readonly TopicDelta[],
  gainedToday: number,
): TopicDelta[] {
  const remaining = Math.max(0, DAILY_GROWTH_CAP_PCT - gainedToday);
  const requested = deltas.reduce((sum, delta) => sum + Math.max(0, delta.deltaPct), 0);

  if (requested <= remaining) {
    return [...deltas];
  }

  const factor = requested === 0 ? 0 : remaining / requested;

  const scaled = deltas.map((delta) =>
    delta.deltaPct <= 0 ? delta : { ...delta, deltaPct: roundTo(delta.deltaPct * factor, 2) },
  );

  const total = scaled.reduce((sum, delta) => sum + Math.max(0, delta.deltaPct), 0);
  const excess = roundTo(total - remaining, 2);

  if (excess <= 0) {
    return scaled;
  }

  let largestIndex = -1;
  for (const [index, delta] of scaled.entries()) {
    if (delta.deltaPct > 0 && (largestIndex === -1 || delta.deltaPct > (scaled[largestIndex]?.deltaPct ?? 0))) {
      largestIndex = index;
    }
  }

  const largest = largestIndex === -1 ? undefined : scaled[largestIndex];
  if (largest === undefined) {
    return scaled;
  }

  scaled[largestIndex] = {
    ...largest,
    deltaPct: roundTo(Math.max(0, largest.deltaPct - excess), 2),
  };

  return scaled;
}


export const HIGHLIGHT_LIMIT = 3;


export const FOCUS_BELOW_PCT = 60;


export const STRENGTH_FROM_PCT = 70;

export interface Highlights {
  readonly strengths: readonly TopicDelta[];
  readonly focus: readonly TopicDelta[];
}

function byObserved(direction: 'asc' | 'desc') {
  return (left: TopicDelta, right: TopicDelta): number => {
    const diff =
      direction === 'asc'
        ? left.observedPct - right.observedPct
        : right.observedPct - left.observedPct;
    if (diff !== 0) {
      return diff;
    }
    const weightDiff = right.evidenceWeight - left.evidenceWeight;
    return weightDiff !== 0 ? weightDiff : left.topicId.localeCompare(right.topicId);
  };
}

export function pickHighlights(deltas: readonly TopicDelta[]): Highlights {
  const strengths = deltas
    .filter((delta) => delta.observedPct >= STRENGTH_FROM_PCT)
    .sort(byObserved('desc'))
    .slice(0, HIGHLIGHT_LIMIT);

  const focus = deltas
    .filter((delta) => delta.observedPct < FOCUS_BELOW_PCT)
    .sort(byObserved('asc'))
    .slice(0, HIGHLIGHT_LIMIT);

  return { strengths, focus };
}
