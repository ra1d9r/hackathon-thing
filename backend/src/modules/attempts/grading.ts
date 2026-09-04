import { z } from 'zod';

import type { AnswerPayload } from '../../contracts/dto/attempts.js';
import { roundTo, type QuestionKind } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import { isJsonObject } from '../../contracts/json.js';

export const answerKeySchema = z.union([
  z.object({ correct: z.array(z.string()).min(1) }),
  z.object({ value: z.number(), tolerance: z.number().min(0).default(0) }),
  z.object({ expected_points: z.array(z.string()).min(1) }),
]);

export type AnswerKey = z.infer<typeof answerKeySchema>;

export function parseAnswerKey(raw: unknown): AnswerKey | null {
  if (!isJsonObject(raw)) {
    return null;
  }
  const parsed = answerKeySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface GradableQuestion {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly points: number;
  readonly answerKey: AnswerKey | null;
}

export interface GradeOutcome {
  readonly grader: 'deterministic' | 'pending';
  readonly isCorrect: boolean | null;
  readonly pointsAwarded: number | null;
}

const PENDING: GradeOutcome = { grader: 'pending', isCorrect: null, pointsAwarded: null };

const NUMERIC_EPSILON = 1e-9;

export const MAX_MULTI_CHOICE = 3;

function gradeChoice(
  question: GradableQuestion,
  answer: AnswerPayload,
  key: Extract<AnswerKey, { correct: string[] }>,
): GradeOutcome {
  const selected = answer.selected ?? [];

  if (question.kind === 'mcq_single' && selected.length !== 1) {
    return { grader: 'deterministic', isCorrect: false, pointsAwarded: 0 };
  }

  const expected = new Set(key.correct);
  const given = new Set(selected);
  const isCorrect =
    expected.size === given.size && [...expected].every((option) => given.has(option));

  return {
    grader: 'deterministic',
    isCorrect,
    pointsAwarded: isCorrect ? question.points : 0,
  };
}

function gradeNumeric(
  question: GradableQuestion,
  answer: AnswerPayload,
  key: Extract<AnswerKey, { value: number }>,
): GradeOutcome {
  const given = numericValue(answer);

  if (given === null) {
    return { grader: 'deterministic', isCorrect: false, pointsAwarded: 0 };
  }

  const isCorrect = Math.abs(given - key.value) <= key.tolerance + NUMERIC_EPSILON;
  return {
    grader: 'deterministic',
    isCorrect,
    pointsAwarded: isCorrect ? question.points : 0,
  };
}

function numericValue(answer: AnswerPayload): number | null {
  if (answer.value !== undefined) {
    return answer.value;
  }

  const text = answer.text?.trim().replace(',', '.').replace(/\s/gu, '');
  if (text === undefined || text === '') {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function gradeAnswer(question: GradableQuestion, answer: AnswerPayload): GradeOutcome {
  if (question.kind === 'free_text') {
    return PENDING;
  }

  const key = question.answerKey;
  if (key === null) {
    return PENDING;
  }

  if ('correct' in key) {
    if (question.kind !== 'mcq_single' && question.kind !== 'mcq_multi') {
      return PENDING;
    }
    return gradeChoice(question, answer, key);
  }

  if ('value' in key) {
    if (question.kind !== 'numeric') {
      return PENDING;
    }
    return gradeNumeric(question, answer, key);
  }

  return PENDING;
}

export const SKIPPED: GradeOutcome = {
  grader: 'deterministic',
  isCorrect: false,
  pointsAwarded: 0,
};

export function assertAnswerShape(kind: QuestionKind, answer: AnswerPayload): void {
  const fail = (message: string): never => {
    throw new AppError('VALIDATION_FAILED', { message, details: { kind } });
  };

  switch (kind) {
    case 'mcq_single':
      if (answer.selected?.length !== 1) {
        fail('вопрос с одним ответом ожидает ровно один выбранный вариант');
      }
      return;
    case 'mcq_multi':
      if ((answer.selected?.length ?? 0) === 0) {
        fail('вопрос с несколькими ответами ожидает список выбранных вариантов');
      }
      if ((answer.selected?.length ?? 0) > MAX_MULTI_CHOICE) {
        fail(`можно выбрать не больше ${MAX_MULTI_CHOICE} вариантов`);
      }
      return;
    case 'numeric':
      if (numericValue(answer) === null) {
        fail('числовой вопрос ожидает число');
      }
      return;
    case 'free_text':
      if (answer.text === undefined || answer.text.trim() === '') {
        fail('свободный ответ не может быть пустым');
      }
      return;
  }
}

export interface ScoredQuestion extends GradableQuestion {
  readonly topicId: string;
  readonly subjectId: string;
  readonly outcome: GradeOutcome;
}

export interface DeterministicSummary {
  readonly rawScore: number;
  readonly maxScore: number;
  readonly gradedQuestions: number;
  readonly pendingQuestions: number;
}

export function summarize(scored: readonly ScoredQuestion[]): DeterministicSummary {
  let rawScore = 0;
  let gradedQuestions = 0;
  let pendingQuestions = 0;
  let maxScore = 0;

  for (const question of scored) {
    maxScore += question.points;

    if (question.outcome.grader === 'pending') {
      pendingQuestions += 1;
      continue;
    }

    gradedQuestions += 1;
    rawScore += question.outcome.pointsAwarded ?? 0;
  }

  return {
    rawScore: roundTo(rawScore, 2),
    maxScore: roundTo(maxScore, 2),
    gradedQuestions,
    pendingQuestions,
  };
}
