import { describe, expect, it } from 'vitest';

import { MAX_GRADE, MIN_GRADE } from '../src/contracts/domain.js';
import {
  curriculumScope,
  MAX_TOPICS_IN_CONTEXT,
  topicInScope,
} from '../src/domain/curriculum-scope.js';

describe('охват программы по цели обучения', () => {
  it('«подтянуть предметы» — ровно свой класс', () => {
    const scope = curriculumScope({ goal: 'subjects', grade: 8 });

    expect(scope.gradeMin).toBe(8);
    expect(scope.gradeMax).toBe(8);
  });

  it('НИШ — программа экзамена, а не класс ученика', () => {
    const scope = curriculumScope({
      goal: 'nis',
      grade: 6,
      exam: { gradeMin: 5, gradeMax: 6 },
    });

    expect(scope.gradeMin).toBe(5);
    expect(scope.gradeMax).toBe(6);
  });

  it('ЕНТ — программа экзамена, без пятого и шестого класса', () => {
    const scope = curriculumScope({
      goal: 'ent',
      grade: 11,
      exam: { gradeMin: 7, gradeMax: 11 },
    });

    expect(scope.gradeMin).toBe(7);
    expect(scope.gradeMax).toBe(11);
  });

  it('обрезает программу экзамена классом ученика', () => {
    const scope = curriculumScope({
      goal: 'ent',
      grade: 10,
      exam: { gradeMin: 7, gradeMax: 11 },
    });

    expect(scope.gradeMin).toBe(7);
    expect(scope.gradeMax).toBe(10);
    expect(scope.reason).toContain('до класса ученика');
  });

  it('семикласснику на ЕНТ оставляет только седьмой класс', () => {
    const scope = curriculumScope({ goal: 'ent', grade: 7, exam: { gradeMin: 7, gradeMax: 11 } });

    expect(scope.gradeMin).toBe(7);
    expect(scope.gradeMax).toBe(7);
  });

  it('класс ниже начала программы не даёт пустой охват', () => {
    const scope = curriculumScope({ goal: 'ent', grade: 5, exam: { gradeMin: 7, gradeMax: 11 } });

    expect(scope.gradeMin).toBe(7);
    expect(scope.gradeMax).toBe(7);
  });

  it('шестикласснику на НИШ оставляет 5–6', () => {
    const scope = curriculumScope({ goal: 'nis', grade: 6, exam: { gradeMin: 5, gradeMax: 6 } });

    expect(scope.gradeMin).toBe(5);
    expect(scope.gradeMax).toBe(6);
  });

  it('пятикласснику на НИШ шестого класса ещё не даёт', () => {
    const scope = curriculumScope({ goal: 'nis', grade: 5, exam: { gradeMin: 5, gradeMax: 6 } });

    expect(scope.gradeMax).toBe(5);
  });

  it('экзамен без заявленного охвата не тянет за собой всю школу', () => {
    const scope = curriculumScope({
      goal: 'ent',
      grade: 10,
      exam: { gradeMin: null, gradeMax: null },
    });

    expect(scope.gradeMin).toBe(9);
    expect(scope.gradeMax).toBe(10);
  });

  it('класс за пределами школы прижимается к границам', () => {
    expect(curriculumScope({ goal: 'subjects', grade: 2 }).gradeMin).toBe(MIN_GRADE);
    expect(curriculumScope({ goal: 'subjects', grade: 99 }).gradeMax).toBe(MAX_GRADE);
  });

  it('у охвата есть причина — она уходит в журнал', () => {
    expect(curriculumScope({ goal: 'subjects', grade: 7 }).reason).toContain('класс');
    expect(
      curriculumScope({ goal: 'nis', grade: 6, exam: { gradeMin: 5, gradeMax: 6 } }).reason,
    ).toContain('экзамен');
  });
});

describe('попадание темы в охват', () => {
  const scope = curriculumScope({ goal: 'ent', grade: 11, exam: { gradeMin: 7, gradeMax: 11 } });

  it('тема пересекается с охватом хотя бы одним классом', () => {
    expect(topicInScope({ gradeMin: 7, gradeMax: 7 }, scope)).toBe(true);
    expect(topicInScope({ gradeMin: 9, gradeMax: 11 }, scope)).toBe(true);
  });

  it('тема целиком за пределами охвата не проходит', () => {
    expect(topicInScope({ gradeMin: 5, gradeMax: 6 }, scope)).toBe(false);
  });

  it('для НИШ верно обратное: старшие классы отсекаются', () => {
    const nis = curriculumScope({ goal: 'nis', grade: 6, exam: { gradeMin: 5, gradeMax: 6 } });

    expect(topicInScope({ gradeMin: 5, gradeMax: 6 }, nis)).toBe(true);
    expect(topicInScope({ gradeMin: 10, gradeMax: 11 }, nis)).toBe(false);
  });
});

describe('предел контекста', () => {
  it('объявлен и невелик', () => {
    expect(MAX_TOPICS_IN_CONTEXT).toBeGreaterThan(10);
    expect(MAX_TOPICS_IN_CONTEXT).toBeLessThanOrEqual(100);
  });
});
