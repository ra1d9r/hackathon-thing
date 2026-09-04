import { describe, expect, it } from 'vitest';

import {
  MASTERY_THRESHOLDS,
  clamp,
  isProblemTopic,
  masteryStatus,
  masteryToTenScore,
  normalizeTimeZone,
  roundTo,
  scaleForGoal,
  tenToFiveGrade,
  timeZoneSchema,
} from '../src/contracts/domain.js';
import { localDate, resolveTimeZone } from '../src/domain/day.js';

describe('clamp', () => {
  it('ограничивает значение диапазоном', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('отвергает нечисловое значение и перевёрнутый диапазон', () => {
    expect(() => clamp(Number.NaN, 0, 10)).toThrow(RangeError);
    expect(() => clamp(5, 10, 0)).toThrow(RangeError);
  });
});

describe('roundTo', () => {
  it('округляет до заданного числа знаков', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(38.456, 1)).toBe(38.5);
    expect(roundTo(100, 2)).toBe(100);
  });

  it('отвергает бесконечность', () => {
    expect(() => roundTo(Number.POSITIVE_INFINITY, 2)).toThrow(RangeError);
  });
});

describe('masteryStatus', () => {
  it('расставляет статусы по границам из документации', () => {
    expect(masteryStatus(0)).toBe('weak');
    expect(masteryStatus(39.99)).toBe('weak');
    expect(masteryStatus(MASTERY_THRESHOLDS.weakBelow)).toBe('improving');
    expect(masteryStatus(69.99)).toBe('improving');
    expect(masteryStatus(MASTERY_THRESHOLDS.improvingBelow)).toBe('strong');
    expect(masteryStatus(99.99)).toBe('strong');
    expect(masteryStatus(MASTERY_THRESHOLDS.masteredAt)).toBe('mastered');
  });

  it('не выходит за шкалу при значениях вне диапазона', () => {
    expect(masteryStatus(-10)).toBe('weak');
    expect(masteryStatus(150)).toBe('mastered');
  });
});

describe('isProblemTopic', () => {
  it('считает проблемными только слабые и подтягивающиеся темы', () => {
    expect(isProblemTopic(10)).toBe(true);
    expect(isProblemTopic(55)).toBe(true);
    expect(isProblemTopic(85)).toBe(false);
  });

  it('убирает тему из проблемных при 100% — требование SPEC', () => {
    expect(isProblemTopic(99.9)).toBe(false);
    expect(isProblemTopic(100)).toBe(false);
  });
});

describe('masteryToTenScore', () => {
  it('переводит проценты в оценку из 10, не опускаясь ниже 1', () => {
    expect(masteryToTenScore(0)).toBe(1);
    expect(masteryToTenScore(5)).toBe(1);
    expect(masteryToTenScore(50)).toBe(5);
    expect(masteryToTenScore(95)).toBe(10);
    expect(masteryToTenScore(100)).toBe(10);
  });
});

describe('tenToFiveGrade', () => {
  it('следует таблице SPEC: 9-10 → 5, 7-8 → 4, 5-6 → 3, 3-4 → 2, 1-2 → 1', () => {
    const expected = new Map<number, number>([
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 3],
      [6, 3],
      [7, 4],
      [8, 4],
      [9, 5],
      [10, 5],
    ]);

    for (const [ten, five] of expected) {
      expect(tenToFiveGrade(ten)).toBe(five);
    }
  });

  it('приводит значения вне шкалы к её границам', () => {
    expect(tenToFiveGrade(0)).toBe(1);
    expect(tenToFiveGrade(-5)).toBe(1);
    expect(tenToFiveGrade(42)).toBe(5);
  });

  it('округляет дробные значения перед переводом', () => {
    expect(tenToFiveGrade(6.6)).toBe(4);
    expect(tenToFiveGrade(6.4)).toBe(3);
  });
});

describe('scaleForGoal', () => {
  it('для экзаменационных целей использует баллы, для подтягивания — десятку', () => {
    expect(scaleForGoal('ent')).toBe('points');
    expect(scaleForGoal('nis')).toBe('points');
    expect(scaleForGoal('subjects')).toBe('ten');
  });
});

describe('часовой пояс', () => {
  it('принимает зоны IANA', () => {
    expect(normalizeTimeZone('Asia/Almaty')).toBe('Asia/Almaty');
    expect(normalizeTimeZone('Asia/Aqtobe')).toBe('Asia/Aqtobe');
    expect(normalizeTimeZone('UTC')).toBe('UTC');
  });

  it('пропускает устаревшие псевдонимы', () => {
    expect(normalizeTimeZone('Europe/Kiev')).not.toBeNull();
  });

  it('отвергает мусор', () => {
    expect(normalizeTimeZone('Mars/Phobos')).toBeNull();
    expect(normalizeTimeZone('не пояс')).toBeNull();
    expect(normalizeTimeZone('   ')).toBeNull();
  });

  it('отвергает постоянное смещение вместо зоны', () => {
    expect(normalizeTimeZone('+05:00')).toBeNull();
    expect(normalizeTimeZone('-03:00')).toBeNull();
  });

  it('отвергает непригодный пояс в запросе', () => {
    expect(timeZoneSchema.safeParse('Asia/Almaty').success).toBe(true);
    const result = timeZoneSchema.safeParse('Mars/Phobos');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('неизвестный часовой пояс');
  });

  it('откатывается к UTC для значений, записанных до проверки', () => {
    expect(resolveTimeZone('Mars/Phobos')).toBe('UTC');
    expect(resolveTimeZone(null)).toBe('UTC');
    expect(resolveTimeZone('')).toBe('UTC');
    expect(resolveTimeZone('Asia/Almaty')).toBe('Asia/Almaty');
  });

  it('считает локальную дату по поясу ученика', () => {
    const moment = new Date('2026-08-24T20:30:00Z');
    expect(localDate('Asia/Almaty', moment)).toBe('2026-08-25');
    expect(localDate('UTC', moment)).toBe('2026-08-24');
  });
});
