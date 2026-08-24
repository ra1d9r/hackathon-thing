import {
  clamp,
  masteryToTenScore,
  MAX_TEN_SCORE,
  roundTo,
  tenToFiveGrade,
  type FiveGrade,
  type ScaleKind,
} from '../contracts/domain.js';

export const MASTERY_TO_POINTS_GAMMA = 1.15;

export const AI_SCORE_TOLERANCE = 0.1;

export const MOCK_RECENCY_DAYS = 45;

export const MOCK_MAX_WEIGHT = 0.6;

export interface ExamSection {
  readonly subjectId: string | null;
  readonly slotKind: 'mandatory' | 'profile';
  readonly slotIndex: number;
  readonly maxPoints: number;
  readonly guessFloor: number;
}

export interface SectionEstimate {
  readonly subjectId: string | null;
  readonly slotKind: 'mandatory' | 'profile';
  readonly slotIndex: number;
  readonly masteryPct: number;
  readonly maxPoints: number;
  readonly points: number;
}

export function sectionPoints(section: ExamSection, masteryPct: number): number {
  const mastery = clamp(masteryPct, 0, 100) / 100;
  const floor = clamp(section.guessFloor, 0, 0.99);
  const ratio = floor + (1 - floor) * mastery ** MASTERY_TO_POINTS_GAMMA;

  return roundTo(section.maxPoints * ratio, 2);
}

export interface ExamBaselineInput {
  readonly sections: readonly ExamSection[];
  readonly maxScore: number;
  readonly subjectMastery: ReadonlyMap<string, number>;
  readonly profileSubjectIds: readonly string[];
}

export interface ExamBaseline {
  readonly value: number;
  readonly maxScore: number;
  readonly sections: readonly SectionEstimate[];
}

function subjectForSection(
  section: ExamSection,
  profileSubjectIds: readonly string[],
): string | null {
  if (section.subjectId !== null) {
    return section.subjectId;
  }
  return profileSubjectIds[section.slotIndex - 1] ?? null;
}

export function examBaseline(input: ExamBaselineInput): ExamBaseline {
  const sections: SectionEstimate[] = input.sections.map((section) => {
    const subjectId = subjectForSection(section, input.profileSubjectIds);
    const mastery = subjectId === null ? 0 : (input.subjectMastery.get(subjectId) ?? 0);

    return {
      subjectId,
      slotKind: section.slotKind,
      slotIndex: section.slotIndex,
      masteryPct: roundTo(mastery, 2),
      maxPoints: section.maxPoints,
      points: sectionPoints(section, mastery),
    };
  });

  const total = sections.reduce((sum, section) => sum + section.points, 0);

  return {
    value: clamp(Math.round(total), 0, input.maxScore),
    maxScore: input.maxScore,
    sections,
  };
}

export interface MockResult {
  readonly scaledScore: number;
  readonly daysAgo: number;
}

export function blendWithMock(masteryBased: number, mock: MockResult | null): number {
  if (mock === null || mock.daysAgo > MOCK_RECENCY_DAYS) {
    return masteryBased;
  }

  const recency = Math.max(0, 1 - mock.daysAgo / MOCK_RECENCY_DAYS);
  const weight = MOCK_MAX_WEIGHT * recency;

  return (1 - weight) * masteryBased + weight * mock.scaledScore;
}

export const MAX_TEN = MAX_TEN_SCORE;

export interface TenScaleBaseline {
  readonly value: number;
  readonly maxScore: number;
  readonly fiveGrade: FiveGrade;
}

export function tenScaleBaseline(subjectMastery: readonly number[]): TenScaleBaseline {
  const average =
    subjectMastery.length === 0
      ? 0
      : subjectMastery.reduce((sum, value) => sum + value, 0) / subjectMastery.length;

  const ten = masteryToTenScore(average);

  return { value: ten, maxScore: MAX_TEN, fiveGrade: tenToFiveGrade(ten) };
}

export function clampAiScore(aiValue: number, baseline: number, maxScore: number): number {
  const tolerance = maxScore * AI_SCORE_TOLERANCE;

  return roundTo(
    clamp(clamp(aiValue, baseline - tolerance, baseline + tolerance), 0, maxScore),
    2,
  );
}

export interface PredictedScore {
  readonly scale: ScaleKind;
  readonly value: number;
  readonly baselineValue: number;
  readonly maxScore: number;
  readonly source: 'ai' | 'baseline';
}

export function scoreConfidence(
  topicConfidences: readonly number[],
  topicsExpected: number,
): number {
  if (topicConfidences.length === 0) {
    return 0;
  }

  const average =
    topicConfidences.reduce((sum, value) => sum + value, 0) / topicConfidences.length;
  const coverage = topicsExpected === 0 ? 1 : clamp(topicConfidences.length / topicsExpected, 0, 1);

  return roundTo(clamp(average * coverage, 0, 1), 2);
}
