import { describe, expect, it } from 'vitest';

import {
  advanceStreak,
  DAILY_ITEMS,
  itemMeta,
  ITEM_MINUTES,
  planDailyItems,
  previousDate,
  type DailyCandidate,
} from '../src/domain/daily.js';

describe('серия дней', () => {
  const empty = { current: 0, longest: 0, lastCompletedDate: null };

  it('первый засчитанный день начинает серию', () => {
    expect(advanceStreak(empty, '2026-08-24')).toEqual({
      current: 1,
      longest: 1,
      lastCompletedDate: '2026-08-24',
    });
  });

  it('вчерашний день продлевает серию', () => {
    const state = { current: 4, longest: 9, lastCompletedDate: '2026-08-23' };

    expect(advanceStreak(state, '2026-08-24')).toEqual({
      current: 5,
      longest: 9,
      lastCompletedDate: '2026-08-24',
    });
  });

  it('повторное срабатывание того же дня ничего не меняет', () => {
    const state = { current: 5, longest: 9, lastCompletedDate: '2026-08-24' };

    expect(advanceStreak(state, '2026-08-24')).toBe(state);
  });

  it('пропуск дня начинает серию заново', () => {
    const state = { current: 12, longest: 12, lastCompletedDate: '2026-08-20' };

    expect(advanceStreak(state, '2026-08-24')).toEqual({
      current: 1,
      longest: 12,
      lastCompletedDate: '2026-08-24',
    });
  });

  it('наибольшая серия не уменьшается', () => {
    const state = { current: 12, longest: 12, lastCompletedDate: '2026-08-01' };

    expect(advanceStreak(state, '2026-08-24').longest).toBe(12);
  });

  it('день из прошлого не продлевает серию задним числом', () => {
    const state = { current: 3, longest: 5, lastCompletedDate: '2026-08-24' };

    expect(advanceStreak(state, '2026-08-20').current).toBe(1);
  });
});

describe('предыдущая дата', () => {
  it('переходит через границу месяца', () => {
    expect(previousDate('2026-09-01')).toBe('2026-08-31');
  });

  it('переходит через границу года', () => {
    expect(previousDate('2026-01-01')).toBe('2025-12-31');
  });

  it('знает про високосный год', () => {
    expect(previousDate('2028-03-01')).toBe('2028-02-29');
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
  });
});

describe('отбор пунктов плана', () => {
  function candidate(overrides: Partial<DailyCandidate> & { topicId: string }): DailyCandidate {
    return {
      subjectId: 'subject',
      title: overrides.topicId,
      masteryPct: 50,
      priority: 1,
      lessonId: `lesson-${overrides.topicId}`,
      nodePosition: null,
      nodeAvailable: false,
      daysSincePractice: null,
      ...overrides,
    };
  }

  it('берёт по одному пункту каждого вида', () => {
    const items = planDailyItems([
      candidate({ topicId: 'слабая', masteryPct: 20, priority: 9 }),
      candidate({ topicId: 'узел', masteryPct: 60, nodePosition: 1, nodeAvailable: true }),
      candidate({ topicId: 'сильная', masteryPct: 95, daysSincePractice: 30 }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['task', 'lesson', 'review']);
    expect(items.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('в задачу берёт самую приоритетную проблемную тему', () => {
    const items = planDailyItems([
      candidate({ topicId: 'низкий', masteryPct: 30, priority: 1 }),
      candidate({ topicId: 'высокий', masteryPct: 30, priority: 9 }),
    ]);

    expect(items[0]?.topicId).toBe('высокий');
  });

  it('в урок берёт узел карты с наименьшей позицией', () => {
    const items = planDailyItems([
      candidate({ topicId: 'третий', nodePosition: 3, nodeAvailable: true, masteryPct: 100 }),
      candidate({ topicId: 'первый', nodePosition: 1, nodeAvailable: true, masteryPct: 100 }),
    ]);

    expect(items.find((item) => item.kind === 'lesson')?.topicId).toBe('первый');
  });

  it('не берёт в урок запертый узел', () => {
    const items = planDailyItems([
      candidate({ topicId: 'заперт', nodePosition: 1, nodeAvailable: false, masteryPct: 100 }),
    ]);

    expect(items.some((item) => item.kind === 'lesson')).toBe(false);
  });

  it('в повторение берёт тему, которую дольше всех не трогали', () => {
    const items = planDailyItems([
      candidate({ topicId: 'недавняя', masteryPct: 90, daysSincePractice: 2 }),
      candidate({ topicId: 'давняя', masteryPct: 90, daysSincePractice: 40 }),
    ]);

    expect(items.find((item) => item.kind === 'review')?.topicId).toBe('давняя');
  });

  it('тему, по которой занятий не было, считает самой давней', () => {
    const items = planDailyItems([
      candidate({ topicId: 'была', masteryPct: 90, daysSincePractice: 100 }),
      candidate({ topicId: 'не-была', masteryPct: 90, daysSincePractice: null }),
    ]);

    expect(items.find((item) => item.kind === 'review')?.topicId).toBe('не-была');
  });

  it('пропускает темы без урока — пункту некуда вести', () => {
    const items = planDailyItems([
      candidate({ topicId: 'без-урока', masteryPct: 10, priority: 9, lessonId: null }),
      candidate({ topicId: 'с-уроком', masteryPct: 20, priority: 1 }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.topicId).toBe('с-уроком');
  });

  it('не повторяет тему в двух пунктах', () => {
    const items = planDailyItems([
      candidate({ topicId: 'одна', masteryPct: 30, priority: 9, nodePosition: 1, nodeAvailable: true }),
      candidate({ topicId: 'вторая', masteryPct: 40 }),
      candidate({ topicId: 'третья', masteryPct: 50 }),
    ]);

    expect(new Set(items.map((item) => item.topicId)).size).toBe(items.length);
  });

  it('добирает план до трёх пунктов, если видов не хватило', () => {
    const items = planDailyItems([
      candidate({ topicId: 'a', masteryPct: 30 }),
      candidate({ topicId: 'b', masteryPct: 35 }),
      candidate({ topicId: 'c', masteryPct: 40 }),
    ]);

    expect(items).toHaveLength(DAILY_ITEMS);
  });

  it('не выдумывает пункты, когда тем меньше трёх', () => {
    expect(planDailyItems([candidate({ topicId: 'одна' })])).toHaveLength(1);
    expect(planDailyItems([])).toHaveLength(0);
  });

  it('проставляет время по виду пункта', () => {
    const items = planDailyItems([
      candidate({ topicId: 'слабая', masteryPct: 20, priority: 9 }),
      candidate({ topicId: 'узел', masteryPct: 60, nodePosition: 1, nodeAvailable: true }),
    ]);

    expect(items[0]?.estMinutes).toBe(ITEM_MINUTES.task);
    expect(items[1]?.estMinutes).toBe(ITEM_MINUTES.lesson);
  });

  it('даёт один и тот же план на одних и тех же данных', () => {
    const input = [
      candidate({ topicId: 'a', masteryPct: 30, priority: 5 }),
      candidate({ topicId: 'b', masteryPct: 30, priority: 5 }),
      candidate({ topicId: 'c', masteryPct: 30, priority: 5 }),
    ];

    expect(planDailyItems(input).map((item) => item.topicId)).toEqual(
      planDailyItems([...input].reverse()).map((item) => item.topicId),
    );
  });
});

describe('подпись пункта', () => {
  it('без числа вопросов оставляет только время', () => {
    expect(itemMeta(20, null)).toBe('20 мин');
  });

  it('склоняет «вопрос» по числу', () => {
    expect(itemMeta(20, 1)).toBe('20 мин • 1 вопрос');
    expect(itemMeta(20, 3)).toBe('20 мин • 3 вопроса');
    expect(itemMeta(20, 5)).toBe('20 мин • 5 вопросов');
    expect(itemMeta(20, 11)).toBe('20 мин • 11 вопросов');
    expect(itemMeta(20, 21)).toBe('20 мин • 21 вопрос');
  });
});
