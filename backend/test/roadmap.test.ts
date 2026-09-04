import { describe, expect, it } from 'vitest';

import {
  COMPLETE_CHECK_PCT,
  MATERIAL_WEIGHT_PCT,
  MAX_NODES,
  nodeProgress,
  nodeStatus,
  orderTopics,
  overallProgressPct,
  replanBucket,
  REPLAN_WINDOW_MS,
  unlockNodes,
  type PlannableTopic,
} from '../src/domain/roadmap.js';

describe('прогресс узла', () => {
  it('материал даёт 30 %, проверка — остальные 70 %', () => {
    expect(nodeProgress({ materialRead: true, bestCheckPct: null }).progressPct).toBe(
      MATERIAL_WEIGHT_PCT,
    );
    expect(nodeProgress({ materialRead: false, bestCheckPct: 100 }).progressPct).toBe(70);
    expect(nodeProgress({ materialRead: true, bestCheckPct: 100 }).progressPct).toBe(100);
  });

  it('без прочитанного материала и проверки прогресса нет', () => {
    expect(nodeProgress({ materialRead: false, bestCheckPct: null })).toEqual({
      progressPct: 0,
      completed: false,
    });
  });

  it('засчитывает узел при материале и проверке от 80 %', () => {
    const result = nodeProgress({ materialRead: true, bestCheckPct: COMPLETE_CHECK_PCT });

    expect(result.progressPct).toBe(86);
    expect(result.completed).toBe(true);
  });

  it('не засчитывает узел при высокой проверке без прочитанного материала', () => {
    expect(nodeProgress({ materialRead: false, bestCheckPct: 100 }).completed).toBe(false);
  });

  it('не засчитывает узел при проверке ниже порога', () => {
    expect(nodeProgress({ materialRead: true, bestCheckPct: 79 }).completed).toBe(false);
  });

  it('удерживает результат проверки в границах шкалы', () => {
    expect(nodeProgress({ materialRead: true, bestCheckPct: 140 }).progressPct).toBe(100);
    expect(nodeProgress({ materialRead: false, bestCheckPct: -20 }).progressPct).toBe(0);
  });
});

describe('статус узла', () => {
  it('запирает узел с невыполненными пререквизитами', () => {
    expect(
      nodeStatus({ prerequisitesMet: false, materialRead: false, bestCheckPct: null }),
    ).toBe('locked');
  });

  it('открывает узел с выполненными пререквизитами', () => {
    expect(
      nodeStatus({ prerequisitesMet: true, materialRead: false, bestCheckPct: null }),
    ).toBe('available');
  });

  it('не запирает узел обратно, если ученик уже начал', () => {
    expect(
      nodeStatus({ prerequisitesMet: false, materialRead: true, bestCheckPct: null }),
    ).toBe('in_progress');
  });

  it('завершённый узел остаётся завершённым при запертых пререквизитах', () => {
    expect(
      nodeStatus({ prerequisitesMet: false, materialRead: true, bestCheckPct: 90 }),
    ).toBe('completed');
  });
});

describe('общий прогресс карты', () => {
  it('усредняет по узлам', () => {
    expect(overallProgressPct([{ progressPct: 100 }, { progressPct: 0 }])).toBe(50);
  });

  it('пустая карта даёт ноль, а не деление на ноль', () => {
    expect(overallProgressPct([])).toBe(0);
  });
});

describe('порядок тем', () => {
  function topic(overrides: Partial<PlannableTopic> & { topicId: string }): PlannableTopic {
    return {
      title: overrides.topicId,
      prerequisiteIds: [],
      priority: 0,
      sortOrder: 100,
      ...overrides,
    };
  }

  it('ставит тему после её пререквизита', () => {
    const ordered = orderTopics([
      topic({ topicId: 'b', prerequisiteIds: ['a'], priority: 90 }),
      topic({ topicId: 'a', priority: 10 }),
    ]);

    expect(ordered.map((item) => item.topicId)).toEqual(['a', 'b']);
  });

  it('внутри слоя сортирует по приоритету', () => {
    const ordered = orderTopics([
      topic({ topicId: 'low', priority: 1 }),
      topic({ topicId: 'high', priority: 99 }),
    ]);

    expect(ordered.map((item) => item.topicId)).toEqual(['high', 'low']);
  });

  it('при равном приоритете держится порядка программы', () => {
    const ordered = orderTopics([
      topic({ topicId: 'second', sortOrder: 20 }),
      topic({ topicId: 'first', sortOrder: 10 }),
    ]);

    expect(ordered.map((item) => item.topicId)).toEqual(['first', 'second']);
  });

  it('игнорирует пререквизиты, которых нет в наборе', () => {
    const ordered = orderTopics([topic({ topicId: 'a', prerequisiteIds: ['вне-охвата'] })]);

    expect(ordered.map((item) => item.topicId)).toEqual(['a']);
  });

  it('не зацикливается на взаимных пререквизитах', () => {
    const ordered = orderTopics([
      topic({ topicId: 'a', prerequisiteIds: ['b'], sortOrder: 20 }),
      topic({ topicId: 'b', prerequisiteIds: ['a'], sortOrder: 10 }),
    ]);

    expect(ordered.map((item) => item.topicId)).toEqual(['b', 'a']);
  });

  it('не отдаёт больше предельного числа узлов', () => {
    const many = Array.from({ length: MAX_NODES + 10 }, (_, index) =>
      topic({ topicId: `t${index}`, sortOrder: index }),
    );

    expect(orderTopics(many)).toHaveLength(MAX_NODES);
  });

  it('даёт один и тот же порядок на одних и тех же данных', () => {
    const input = [
      topic({ topicId: 'b', priority: 5, sortOrder: 10 }),
      topic({ topicId: 'a', priority: 5, sortOrder: 10 }),
    ];

    expect(orderTopics(input).map((item) => item.topicId)).toEqual(
      orderTopics([...input].reverse()).map((item) => item.topicId),
    );
  });
});

describe('разблокировка узлов', () => {
  it('открывает первый узел даже без выполненных пререквизитов', () => {
    const [first] = unlockNodes([
      {
        topicId: 'a',
        position: 1,
        prerequisiteIds: ['b'],
        materialRead: false,
        bestCheckPct: null,
      },
      { topicId: 'b', position: 2, prerequisiteIds: [], materialRead: false, bestCheckPct: null },
    ]);

    expect(first?.status).toBe('available');
  });

  it('открывает следующий узел после завершения предыдущего', () => {
    const states = unlockNodes([
      { topicId: 'a', position: 1, prerequisiteIds: [], materialRead: true, bestCheckPct: 90 },
      { topicId: 'b', position: 2, prerequisiteIds: ['a'], materialRead: false, bestCheckPct: null },
    ]);

    expect(states[0]?.status).toBe('completed');
    expect(states[1]?.status).toBe('available');
  });

  it('держит узел запертым, пока пререквизит не завершён', () => {
    const states = unlockNodes([
      { topicId: 'a', position: 1, prerequisiteIds: [], materialRead: true, bestCheckPct: null },
      { topicId: 'b', position: 2, prerequisiteIds: ['a'], materialRead: false, bestCheckPct: null },
    ]);

    expect(states[0]?.status).toBe('in_progress');
    expect(states[1]?.status).toBe('locked');
  });

  it('не запирает за темой, которой нет в карте', () => {
    const states = unlockNodes([
      { topicId: 'a', position: 1, prerequisiteIds: [], materialRead: true, bestCheckPct: 90 },
      {
        topicId: 'b',
        position: 2,
        prerequisiteIds: ['вне-карты'],
        materialRead: false,
        bestCheckPct: null,
      },
    ]);

    expect(states[1]?.status).toBe('available');
  });

  it('разбирает узлы по позиции, а не по порядку в списке', () => {
    const states = unlockNodes([
      { topicId: 'b', position: 2, prerequisiteIds: ['a'], materialRead: false, bestCheckPct: null },
      { topicId: 'a', position: 1, prerequisiteIds: [], materialRead: true, bestCheckPct: 90 },
    ]);

    expect(states.map((state) => state.topicId)).toEqual(['a', 'b']);
    expect(states[1]?.status).toBe('available');
  });
});

describe('окно перепланирования', () => {
  it('держит один номер корзины внутри шести часов', () => {
    const start = new Date('2026-08-24T00:00:00Z');
    const later = new Date(start.getTime() + REPLAN_WINDOW_MS - 1000);

    expect(replanBucket(start)).toBe(replanBucket(later));
  });

  it('меняет номер корзины за границей окна', () => {
    const start = new Date('2026-08-24T00:00:00Z');
    const after = new Date(start.getTime() + REPLAN_WINDOW_MS);

    expect(replanBucket(after)).toBe(replanBucket(start) + 1);
  });
});
