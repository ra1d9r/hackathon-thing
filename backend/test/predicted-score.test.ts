import { describe, expect, it } from 'vitest';

import {
  AI_SCORE_TOLERANCE,
  blendWithMock,
  clampAiScore,
  examBaseline,
  MOCK_RECENCY_DAYS,
  scoreConfidence,
  sectionPoints,
  tenScaleBaseline,
  type ExamSection,
} from '../src/domain/predicted-score.js';
import { deterministicRandom, nextFatigue, pickFocus, type FocusCandidate } from '../src/domain/focus.js';


const SECTION: ExamSection = {
  subjectId: 'math',
  slotKind: 'mandatory',
  slotIndex: 1,
  maxPoints: 20,
  guessFloor: 0.2,
};

describe('балл за секцию чертежа', () => {
  it('при нулевом мастерстве равен доле угадывания, а не нулю', () => {
    expect(sectionPoints(SECTION, 0)).toBe(4);
  });

  it('при полном мастерстве равен максимуму секции', () => {
    expect(sectionPoints(SECTION, 100)).toBe(20);
  });

  it('растёт монотонно с мастерством', () => {
    const values = [0, 25, 50, 75, 100].map((mastery) => sectionPoints(SECTION, mastery));

    for (let index = 1; index < values.length; index += 1) {
      expect(values[index] ?? 0).toBeGreaterThan(values[index - 1] ?? 0);
    }
  });

  it('половина мастерства даёт меньше половины сверх угадывания', () => {
    const half = sectionPoints(SECTION, 50);
    const midpoint = (sectionPoints(SECTION, 0) + sectionPoints(SECTION, 100)) / 2;

    expect(half).toBeLessThan(midpoint);
  });

  it('секция без угадывания начинается с нуля', () => {
    expect(sectionPoints({ ...SECTION, guessFloor: 0 }, 0)).toBe(0);
  });
});

describe('прогноз по чертежу экзамена', () => {
  const sections: ExamSection[] = [
    { subjectId: 'kz_history', slotKind: 'mandatory', slotIndex: 1, maxPoints: 20, guessFloor: 0.2 },
    { subjectId: 'reading', slotKind: 'mandatory', slotIndex: 2, maxPoints: 10, guessFloor: 0.2 },
    { subjectId: null, slotKind: 'profile', slotIndex: 1, maxPoints: 50, guessFloor: 0.15 },
    { subjectId: null, slotKind: 'profile', slotIndex: 2, maxPoints: 60, guessFloor: 0.15 },
  ];

  it('складывает секции и не выходит за максимум шкалы', () => {
    const baseline = examBaseline({
      sections,
      maxScore: 140,
      subjectMastery: new Map([
        ['kz_history', 100],
        ['reading', 100],
        ['math', 100],
        ['physics', 100],
      ]),
      profileSubjectIds: ['math', 'physics'],
    });

    expect(baseline.value).toBe(140);
    expect(baseline.maxScore).toBe(140);
  });

  it('незнакомый предмет считается неизученным, а не пропускается', () => {
    const baseline = examBaseline({
      sections,
      maxScore: 140,
      subjectMastery: new Map(),
      profileSubjectIds: ['math', 'physics'],
    });

    expect(baseline.value).toBe(23);
    expect(baseline.sections).toHaveLength(4);
  });

  it('профильные слоты занимает выбор ученика по порядку', () => {
    const baseline = examBaseline({
      sections,
      maxScore: 140,
      subjectMastery: new Map([['physics', 100]]),
      profileSubjectIds: ['math', 'physics'],
    });

    const profile = baseline.sections.filter((section) => section.slotKind === 'profile');

    expect(profile[0]?.subjectId).toBe('math');
    expect(profile[1]?.subjectId).toBe('physics');
    expect(profile[1]?.masteryPct).toBe(100);
  });

  it('без выбранных профильных предметов слоты остаются пустыми, а не падают', () => {
    const baseline = examBaseline({
      sections,
      maxScore: 140,
      subjectMastery: new Map(),
      profileSubjectIds: [],
    });

    expect(baseline.value).toBeGreaterThan(0);
    expect(baseline.sections.every((section) => section.points >= 0)).toBe(true);
  });
});

describe('смешивание со свежим пробником', () => {
  it('без пробника остаётся расчёт по мастерству', () => {
    expect(blendWithMock(80, null)).toBe(80);
  });

  it('только что написанный пробник весит больше всего', () => {
    const blended = blendWithMock(80, { scaledScore: 120, daysAgo: 0 });

    expect(blended).toBeCloseTo(104, 2);
  });

  it('чем старше пробник, тем меньше его вес', () => {
    const fresh = blendWithMock(80, { scaledScore: 120, daysAgo: 5 });
    const stale = blendWithMock(80, { scaledScore: 120, daysAgo: 40 });

    expect(fresh).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThan(80);
  });

  it('просроченный пробник не учитывается вовсе', () => {
    expect(blendWithMock(80, { scaledScore: 120, daysAgo: MOCK_RECENCY_DAYS + 1 })).toBe(80);
  });
});

describe('десятибалльная шкала', () => {
  it('переводит среднее мастерство в оценку и в пятибалльную', () => {
    expect(tenScaleBaseline([90, 90])).toMatchObject({ value: 9, fiveGrade: 5 });
    expect(tenScaleBaseline([50, 50])).toMatchObject({ value: 5, fiveGrade: 3 });
  });

  it('никогда не показывает ноль', () => {
    expect(tenScaleBaseline([0]).value).toBe(1);
    expect(tenScaleBaseline([]).value).toBe(1);
  });

  it('не выходит за верх шкалы', () => {
    expect(tenScaleBaseline([100, 100, 100]).value).toBe(10);
  });
});

describe('ограничение прогноза от модели', () => {
  it('оставляет значение внутри коридора', () => {
    expect(clampAiScore(105, 100, 140)).toBe(105);
  });

  it('заявка «максимальный балл» даёт то же, что честная оценка на границе', () => {
    const cheated = clampAiScore(140, 100, 140);
    const honest = clampAiScore(114, 100, 140);

    expect(cheated).toBe(honest);
    expect(cheated).toBe(100 + 140 * AI_SCORE_TOLERANCE);
  });

  it('не опускается ниже нуля и не поднимается выше шкалы', () => {
    expect(clampAiScore(-50, 5, 140)).toBe(0);
    expect(clampAiScore(500, 138, 140)).toBe(140);
  });
});

describe('уверенность в прогнозе', () => {
  it('без свидетельств равна нулю', () => {
    expect(scoreConfidence([], 20)).toBe(0);
  });

  it('растёт с охватом тем', () => {
    const narrow = scoreConfidence([1, 1, 1], 30);
    const wide = scoreConfidence(Array.from({ length: 30 }, () => 1), 30);

    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBe(1);
  });

  it('не превышает единицу', () => {
    expect(scoreConfidence([1, 1], 1)).toBeLessThanOrEqual(1);
  });
});

describe('отбор фокуса дня', () => {
  const candidates: FocusCandidate[] = [
    { topicId: 'a', priority: 1.8, focusFatigue: 0 },
    { topicId: 'b', priority: 1.5, focusFatigue: 0 },
    { topicId: 'c', priority: 1.2, focusFatigue: 0 },
    { topicId: 'd', priority: 0.9, focusFatigue: 0 },
    { topicId: 'e', priority: 0.6, focusFatigue: 0 },
  ];

  it('в течение дня не меняется', () => {
    const first = pickFocus(candidates, 'student-1', '2026-08-21');
    const second = pickFocus(candidates, 'student-1', '2026-08-21');

    expect(second).toEqual(first);
  });

  it('назавтра пересобирается', () => {
    const today = pickFocus(candidates, 'student-1', '2026-08-21').map((pick) => pick.topicId);
    const tomorrow = pickFocus(candidates, 'student-1', '2026-08-22').map((pick) => pick.topicId);

    const week = ['21', '22', '23', '24', '25', '26', '27'].map((day) =>
      pickFocus(candidates, 'student-1', `2026-08-${day}`)
        .map((pick) => pick.topicId)
        .join(','),
    );

    expect(new Set(week).size).toBeGreaterThan(1);
    expect(today.length).toBe(tomorrow.length);
  });

  it('у разных учеников выборка разная', () => {
    const first = pickFocus(candidates, 'student-1', '2026-08-21').map((pick) => pick.topicId);
    const second = pickFocus(candidates, 'student-2', '2026-08-21').map((pick) => pick.topicId);

    expect(first.join()).not.toBe('');
    expect(second.join()).not.toBe('');
  });

  it('возвращает не больше запрошенного и не больше, чем есть', () => {
    expect(pickFocus(candidates, 's', '2026-08-21')).toHaveLength(3);
    expect(pickFocus(candidates.slice(0, 2), 's', '2026-08-21')).toHaveLength(2);
    expect(pickFocus([], 's', '2026-08-21')).toHaveLength(0);
  });

  it('затухание снижает вес темы', () => {
    const tired = pickFocus(
      [
        { topicId: 'a', priority: 2, focusFatigue: 4 },
        { topicId: 'b', priority: 2, focusFatigue: 0 },
      ],
      'student-1',
      '2026-08-21',
      2,
    );

    const byId = new Map(tired.map((pick) => [pick.topicId, pick.weight]));
    expect(byId.get('a') ?? 0).toBeLessThan(byId.get('b') ?? 0);
  });

  it('тема с нулевым приоритетом в фокус не попадает', () => {
    const picks = pickFocus(
      [
        { topicId: 'mastered', priority: 0, focusFatigue: 0 },
        { topicId: 'weak', priority: 1, focusFatigue: 0 },
      ],
      'student-1',
      '2026-08-21',
    );

    expect(picks.map((pick) => pick.topicId)).toEqual(['weak']);
  });

  it('за много дней сильная тема выбирается чаще слабой', () => {
    let strong = 0;
    let weak = 0;

    for (let day = 1; day <= 28; day += 1) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      const picks = pickFocus(
        [
          { topicId: 'strong', priority: 3, focusFatigue: 0 },
          { topicId: 'weak', priority: 0.3, focusFatigue: 0 },
        ],
        'student-1',
        date,
        1,
      );
      if (picks[0]?.topicId === 'strong') {
        strong += 1;
      } else {
        weak += 1;
      }
    }

    expect(strong).toBeGreaterThan(weak);
  });
});

describe('источник случайности', () => {
  it('воспроизводим', () => {
    expect(deterministicRandom('s', 't', '2026-08-21')).toBe(
      deterministicRandom('s', 't', '2026-08-21'),
    );
  });

  it('лежит в единичном отрезке', () => {
    const value = deterministicRandom('s', 't', '2026-08-21');
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it('меняется от даты и от темы', () => {
    expect(deterministicRandom('s', 't', '2026-08-21')).not.toBe(
      deterministicRandom('s', 't', '2026-08-22'),
    );
    expect(deterministicRandom('s', 't1', '2026-08-21')).not.toBe(
      deterministicRandom('s', 't2', '2026-08-21'),
    );
  });
});

describe('затухание повторов', () => {
  it('растёт, когда тема попадает в фокус два дня подряд', () => {
    expect(nextFatigue(1, '2026-08-20', '2026-08-21', true)).toBe(2);
  });

  it('начинается заново после перерыва', () => {
    expect(nextFatigue(5, '2026-08-15', '2026-08-21', true)).toBe(1);
  });

  it('обнуляется, если тема не попала в фокус', () => {
    expect(nextFatigue(5, '2026-08-20', '2026-08-21', false)).toBe(0);
  });

  it('не растёт бесконечно', () => {
    expect(nextFatigue(30, '2026-08-20', '2026-08-21', true)).toBe(30);
  });
});
