import { describe, expect, it } from 'vitest';

import { masteryStatus } from '../src/contracts/domain.js';
import {
  clampAiDelta,
  computeTopicDelta,
  computeTopicDeltas,
  CONVERGENCE_K,
  DELTA_LIMIT_PCT,
  evidenceWeight,
  observedPct,
  pickHighlights,
  type TopicOutcome,
} from '../src/domain/mastery.js';

function outcome(overrides: Partial<TopicOutcome> = {}): TopicOutcome {
  return {
    topicId: 'topic-1',
    subjectId: 'subject-1',
    pointsPossible: 4,
    pointsEarned: 4,
    questionsGraded: 4,
    ...overrides,
  };
}

describe('вес свидетельства', () => {
  it('растёт с числом баллов и упирается в единицу', () => {
    expect(evidenceWeight(1)).toBe(0.25);
    expect(evidenceWeight(2)).toBe(0.5);
    expect(evidenceWeight(4)).toBe(1);
    expect(evidenceWeight(40)).toBe(1);
  });

  it('никогда не равен нулю — база отвергла бы такое событие', () => {
    expect(evidenceWeight(0)).toBeGreaterThan(0);
    expect(evidenceWeight(4, 0)).toBeGreaterThan(0);
  });

  it('пониженное доверие ослабляет свидетельство', () => {
    expect(evidenceWeight(4, 0.5)).toBe(0.5);
    expect(evidenceWeight(4, 1)).toBe(1);
  });
});

describe('доверие к оценке', () => {
  it('сомнительная оценка двигает мастерство слабее бесспорной', () => {
    const trusted = computeTopicDelta(outcome({ pointsEarned: 4, pointsPossible: 4 }), {
      currentMastery: new Map([['topic-1', 80]]),
    });
    const doubted = computeTopicDelta(
      outcome({ pointsEarned: 4, pointsPossible: 4, trust: 0.5 }),
      { currentMastery: new Map([['topic-1', 80]]) },
    );

    expect(doubted.deltaPct).toBeLessThan(trusted.deltaPct);
    expect(doubted.evidenceWeight).toBeLessThan(trusted.evidenceWeight);
  });

  it('балл ученика при этом не меняется — меняется только вес наблюдения', () => {
    const doubted = computeTopicDelta(
      outcome({ pointsEarned: 3, pointsPossible: 4, trust: 0.2 }),
      { currentMastery: new Map([['topic-1', 0]]) },
    );

    expect(doubted.observedPct).toBe(75);
  });
});

describe('наблюдаемый процент', () => {
  it('считается по набранным баллам', () => {
    expect(observedPct(outcome({ pointsEarned: 3, pointsPossible: 4 }))).toBe(75);
  });

  it('у темы без проверенных вопросов равен нулю, а не делится на ноль', () => {
    expect(observedPct(outcome({ pointsEarned: 0, pointsPossible: 0 }))).toBe(0);
  });
});

describe('дельта мастерства', () => {
  it('первый замер задаёт стартовое значение, а не сдвиг', () => {
    const delta = computeTopicDelta(outcome({ pointsEarned: 4, pointsPossible: 4 }), {
      currentMastery: new Map(),
      baselineFromObserved: true,
    });

    expect(delta.baselinePct).toBe(100);
    expect(delta.deltaPct).toBe(0);
  });

  it('одна верная галочка не делает тему освоенной', () => {
    const delta = computeTopicDelta(outcome({ pointsEarned: 1, pointsPossible: 1 }), {
      currentMastery: new Map(),
      baselineFromObserved: true,
    });

    expect(delta.baselinePct).toBe(62.5);
    expect(masteryStatus(delta.baselinePct ?? 0)).not.toBe('mastered');
  });

  it('одна ошибка не обнуляет тему', () => {
    const delta = computeTopicDelta(outcome({ pointsEarned: 0, pointsPossible: 1 }), {
      currentMastery: new Map(),
      baselineFromObserved: true,
    });

    expect(delta.baselinePct).toBe(37.5);
  });

  it('вне диагностики сдвигает оценку на половину расстояния', () => {
    const delta = computeTopicDelta(outcome(), {
      currentMastery: new Map([['topic-1', 40]]),
    });

    expect(delta.deltaPct).toBe(DELTA_LIMIT_PCT);
  });

  it('одна попытка не доводит тему до полного освоения', () => {
    const first = computeTopicDelta(outcome(), { currentMastery: new Map([['topic-1', 0]]) });
    const afterFirst = first.deltaPct;

    const second = computeTopicDelta(outcome(), {
      currentMastery: new Map([['topic-1', afterFirst]]),
    });

    expect(afterFirst + second.deltaPct).toBeLessThan(100);
  });

  it('слабое свидетельство двигает оценку меньше сильного', () => {
    const light = computeTopicDelta(outcome({ pointsEarned: 1, pointsPossible: 1 }), {
      currentMastery: new Map([['topic-1', 50]]),
    });
    const heavy = computeTopicDelta(outcome(), {
      currentMastery: new Map([['topic-1', 50]]),
    });

    expect(light.deltaPct).toBeLessThan(heavy.deltaPct);
    expect(light.deltaPct).toBeCloseTo((100 - 50) * CONVERGENCE_K * 0.25, 2);
  });

  it('плохой результат снижает оценку, но не ниже предела', () => {
    const delta = computeTopicDelta(outcome({ pointsEarned: 0 }), {
      currentMastery: new Map([['topic-1', 100]]),
    });

    expect(delta.deltaPct).toBe(-DELTA_LIMIT_PCT);
  });

  it('темы без проверенных баллов свидетельством не становятся', () => {
    const deltas = computeTopicDeltas(
      [outcome({ pointsPossible: 0, pointsEarned: 0, questionsGraded: 0 })],
      { currentMastery: new Map() },
    );

    expect(deltas).toHaveLength(0);
  });
});

describe('ограничение дельты ИИ', () => {
  it('оставляет значение внутри коридора детерминированного расчёта', () => {
    expect(clampAiDelta(12, 10)).toBe(12);
  });

  it('обрезает попытку выйти за коридор — барьер структурный, не словесный', () => {
    expect(clampAiDelta(100, 10)).toBe(20);
    expect(clampAiDelta(-100, -5)).toBe(-15);
  });

  it('никогда не выходит за границы контракта статистики', () => {
    expect(clampAiDelta(100, DELTA_LIMIT_PCT)).toBe(DELTA_LIMIT_PCT);
  });
});

describe('сильные стороны и фокус', () => {
  const deltas = computeTopicDeltas(
    [
      outcome({ topicId: 'a', pointsEarned: 4, pointsPossible: 4 }),
      outcome({ topicId: 'b', pointsEarned: 3, pointsPossible: 4 }),
      outcome({ topicId: 'c', pointsEarned: 1, pointsPossible: 4 }),
      outcome({ topicId: 'd', pointsEarned: 0, pointsPossible: 4 }),
    ],
    { currentMastery: new Map(), baselineFromObserved: true },
  );

  it('в сильные попадают темы с высоким результатом', () => {
    expect(pickHighlights(deltas).strengths.map((delta) => delta.topicId)).toEqual(['a', 'b']);
  });

  it('в фокус — темы с низким, от худшей к лучшей', () => {
    expect(pickHighlights(deltas).focus.map((delta) => delta.topicId)).toEqual(['d', 'c']);
  });

  it('порядок не зависит от порядка входа', () => {
    const reversed = pickHighlights([...deltas].reverse());
    expect(reversed.focus.map((delta) => delta.topicId)).toEqual(['d', 'c']);
  });
});
