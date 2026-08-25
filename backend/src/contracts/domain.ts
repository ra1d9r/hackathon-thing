import { z } from 'zod';

export const userRoleSchema = z.enum(['student', 'teacher']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const learningGoalSchema = z.enum(['ent', 'nis', 'olympiad', 'subjects']);
export type LearningGoal = z.infer<typeof learningGoalSchema>;

export const EXAM_GOALS = ['ent', 'nis', 'olympiad'] as const;

export function isExamGoal(goal: LearningGoal): boolean {
  return EXAM_GOALS.some((examGoal) => examGoal === goal);
}

export const scaleKindSchema = z.enum(['points', 'ten']);
export type ScaleKind = z.infer<typeof scaleKindSchema>;

export function scaleForGoal(goal: LearningGoal): ScaleKind {
  return isExamGoal(goal) ? 'points' : 'ten';
}

export const MIN_GRADE = 5;
export const MAX_GRADE = 11;

export const gradeSchema = z.number().int().min(MIN_GRADE).max(MAX_GRADE);
export type Grade = z.infer<typeof gradeSchema>;

export const MIN_ROADMAP_NODES = 1;
export const MAX_ROADMAP_NODES = 60;

export const DAILY_ITEMS = 3;

export const MAX_DAILY_ITEMS = 6;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    throw new RangeError('clamp: значение не является числом');
  }
  if (min > max) {
    throw new RangeError('clamp: нижняя граница больше верхней');
  }
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('roundTo: значение не является конечным числом');
  }
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export const masteryStatusSchema = z.enum([
  'unknown',
  'weak',
  'improving',
  'strong',
  'mastered',
]);
export type MasteryStatus = z.infer<typeof masteryStatusSchema>;

export const MASTERY_THRESHOLDS = {
  weakBelow: 40,
  improvingBelow: 70,
  masteredAt: 100,
} as const;

export function masteryStatus(masteryPct: number): MasteryStatus {
  const pct = clamp(masteryPct, 0, 100);
  if (pct >= MASTERY_THRESHOLDS.masteredAt) return 'mastered';
  if (pct < MASTERY_THRESHOLDS.weakBelow) return 'weak';
  if (pct < MASTERY_THRESHOLDS.improvingBelow) return 'improving';
  return 'strong';
}

export function isProblemTopic(masteryPct: number): boolean {
  const status = masteryStatus(masteryPct);
  return masteryPct < MASTERY_THRESHOLDS.masteredAt && (status === 'weak' || status === 'improving');
}

export const MIN_TEN_SCORE = 1;
export const MAX_TEN_SCORE = 10;

export type FiveGrade = 1 | 2 | 3 | 4 | 5;

export function masteryToTenScore(masteryPct: number): number {
  const pct = clamp(masteryPct, 0, 100);
  return clamp(Math.round(pct / 10), MIN_TEN_SCORE, MAX_TEN_SCORE);
}

export function tenToFiveGrade(tenScore: number): FiveGrade {
  const ten = clamp(Math.round(tenScore), MIN_TEN_SCORE, MAX_TEN_SCORE);
  if (ten >= 9) return 5;
  if (ten >= 7) return 4;
  if (ten >= 5) return 3;
  if (ten >= 3) return 2;
  return 1;
}

export const questionKindSchema = z.enum(['mcq_single', 'mcq_multi', 'free_text', 'numeric']);
export type QuestionKind = z.infer<typeof questionKindSchema>;

export const assessmentKindSchema = z.enum([
  'diagnostic',
  'exam_mock',
  'ai_task',
  'knowledge_check',
]);
export type AssessmentKind = z.infer<typeof assessmentKindSchema>;

export const attemptStatusSchema = z.enum([
  'in_progress',
  'submitted',
  'grading',
  'graded',
  'failed',
  'abandoned',
]);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

const FIXED_OFFSET = /^[+-]/u;

const IANA_ZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'));

export function normalizeTimeZone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || FIXED_OFFSET.test(trimmed)) {
    return null;
  }

  if (IANA_ZONES.has(trimmed)) {
    return trimmed;
  }

  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-CA', { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return null;
  }

  return FIXED_OFFSET.test(resolved) ? null : resolved;
}

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value, ctx) => {
    const zone = normalizeTimeZone(value);
    if (zone === null) {
      ctx.addIssue({ code: 'custom', message: 'неизвестный часовой пояс' });
      return z.NEVER;
    }
    return zone;
  });
