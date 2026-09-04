import { describe, expect, it } from 'vitest';

import type { AnswerPayload } from '../src/contracts/dto/attempts.js';
import type { QuestionKind } from '../src/contracts/domain.js';
import { AppError } from '../src/contracts/errors.js';
import {
  assertAnswerShape,
  gradeAnswer,
  parseAnswerKey,
  SKIPPED,
  summarize,
  type GradableQuestion,
  type ScoredQuestion,
} from '../src/modules/attempts/grading.js';

function question(overrides: Partial<GradableQuestion> = {}): GradableQuestion {
  return {
    id: 'q1',
    kind: 'mcq_single',
    points: 2,
    answerKey: { correct: ['b'] },
    ...overrides,
  };
}

describe('разбор эталонного ответа', () => {
  it('принимает все три формы из наполнения', () => {
    expect(parseAnswerKey({ correct: ['a'] })).toEqual({ correct: ['a'] });
    expect(parseAnswerKey({ value: 3, tolerance: 0.1 })).toEqual({ value: 3, tolerance: 0.1 });
    expect(parseAnswerKey({ expected_points: ['ответ 5/8'] })).toEqual({
      expected_points: ['ответ 5/8'],
    });
  });

  it('допуск по умолчанию нулевой', () => {
    expect(parseAnswerKey({ value: 3 })).toEqual({ value: 3, tolerance: 0 });
  });

  it('повреждённый эталон не роняет проверку', () => {
    expect(parseAnswerKey(null)).toBeNull();
    expect(parseAnswerKey('строка')).toBeNull();
    expect(parseAnswerKey({ correct: [] })).toBeNull();
  });
});

describe('вопрос с одним ответом', () => {
  it('верный выбор даёт полный балл', () => {
    expect(gradeAnswer(question(), { selected: ['b'] })).toEqual({
      grader: 'deterministic',
      isCorrect: true,
      pointsAwarded: 2,
    });
  });

  it('неверный выбор даёт ноль, а не отрицательный балл', () => {
    expect(gradeAnswer(question(), { selected: ['a'] })).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it('несколько отметок в вопросе с одним ответом — не ответ', () => {
    expect(gradeAnswer(question(), { selected: ['a', 'b'] })).toMatchObject({ isCorrect: false });
  });
});

describe('вопрос с несколькими ответами', () => {
  const multi = question({ kind: 'mcq_multi', answerKey: { correct: ['a', 'c'] } });

  it('засчитывается только полное совпадение набора', () => {
    expect(gradeAnswer(multi, { selected: ['c', 'a'] })).toMatchObject({ isCorrect: true });
  });

  it('неполный набор не даёт частичного балла', () => {
    expect(gradeAnswer(multi, { selected: ['a'] })).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it('лишняя отметка обнуляет ответ', () => {
    expect(gradeAnswer(multi, { selected: ['a', 'b', 'c'] })).toMatchObject({ isCorrect: false });
  });
});

describe('числовой вопрос', () => {
  const numeric = question({ kind: 'numeric', answerKey: { value: 3, tolerance: 0.1 } });

  it('принимает значение внутри допуска', () => {
    expect(gradeAnswer(numeric, { value: 3.05 })).toMatchObject({ isCorrect: true });
    expect(gradeAnswer(numeric, { value: 2.9 })).toMatchObject({ isCorrect: true });
  });

  it('отвергает значение вне допуска', () => {
    expect(gradeAnswer(numeric, { value: 3.2 })).toMatchObject({ isCorrect: false });
  });

  it('понимает число, записанное текстом с запятой', () => {
    expect(gradeAnswer(numeric, { text: '3,05' })).toMatchObject({ isCorrect: true });
  });

  it('нечисловой текст считает неверным ответом, а не ошибкой', () => {
    expect(gradeAnswer(numeric, { text: 'не знаю' })).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it('точный допуск не страдает от представления double', () => {
    const exact = question({ kind: 'numeric', answerKey: { value: 0.3, tolerance: 0 } });
    expect(gradeAnswer(exact, { value: 0.1 + 0.2 })).toMatchObject({ isCorrect: true });
  });
});

describe('свободный ответ', () => {
  it('остаётся на проверке: балл выставляет модель', () => {
    const free = question({ kind: 'free_text', answerKey: { expected_points: ['5/8'] } });

    expect(gradeAnswer(free, { text: 'вероятность 5/8' })).toEqual({
      grader: 'pending',
      isCorrect: null,
      pointsAwarded: null,
    });
  });
});

describe('вопрос без эталона', () => {
  it('не наказывает ученика за ошибку наполнения', () => {
    expect(gradeAnswer(question({ answerKey: null }), { selected: ['b'] })).toMatchObject({
      grader: 'pending',
    });
  });
});

describe('проверка формы ответа', () => {
  const cases: { kind: QuestionKind; bad: AnswerPayload }[] = [
    { kind: 'mcq_single', bad: { selected: [] } },
    { kind: 'mcq_multi', bad: { selected: [] } },
    { kind: 'numeric', bad: { text: 'абв' } },
    { kind: 'free_text', bad: { text: '   ' } },
  ];

  it.each(cases)('отклоняет несовпадающую форму для $kind', ({ kind, bad }) => {
    expect(() => {
      assertAnswerShape(kind, bad);
    }).toThrow(AppError);
  });

  it('пропускает корректные формы', () => {
    expect(() => {
      assertAnswerShape('mcq_single', { selected: ['a'] });
      assertAnswerShape('mcq_multi', { selected: ['a', 'b'] });
      assertAnswerShape('numeric', { value: 1 });
      assertAnswerShape('free_text', { text: 'ответ' });
    }).not.toThrow();
  });
});

describe('сводка по попытке', () => {
  const scored: ScoredQuestion[] = [
    {
      ...question({ id: 'q1', points: 2 }),
      topicId: 't1',
      subjectId: 's1',
      outcome: { grader: 'deterministic', isCorrect: true, pointsAwarded: 2 },
    },
    {
      ...question({ id: 'q2', points: 1 }),
      topicId: 't1',
      subjectId: 's1',
      outcome: SKIPPED,
    },
    {
      ...question({ id: 'q3', kind: 'free_text', points: 3 }),
      topicId: 't2',
      subjectId: 's1',
      outcome: { grader: 'pending', isCorrect: null, pointsAwarded: null },
    },
  ];

  it('максимум считается по всем вопросам, включая ожидающие оценки', () => {
    expect(summarize(scored)).toEqual({
      rawScore: 2,
      maxScore: 6,
      gradedQuestions: 2,
      pendingQuestions: 1,
    });
  });

  it('пропущенный вопрос — ноль, а не «нет данных»', () => {
    const skipped = scored.filter((question) => question.outcome === SKIPPED);

    expect(summarize(skipped).rawScore).toBe(0);
    expect(summarize(skipped).gradedQuestions).toBe(1);
  });
});
