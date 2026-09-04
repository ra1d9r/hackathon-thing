import { describe, expect, it } from 'vitest';

import {
  assembleMock,
  scaleSections,
  totalScaledScore,
  type BlueprintSection,
  type MockCandidate,
} from '../src/domain/mock-exam.js';

function candidate(id: string, subjectId: string, difficulty = 3): MockCandidate {
  return { questionId: id, subjectId, topicId: `topic-${id}`, difficulty, points: 1 };
}

function pool(subjectId: string, count: number, from = 0): MockCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate(`${subjectId}-${index + from}`, subjectId, (index % 5) + 1),
  );
}

const ENT_SECTIONS: BlueprintSection[] = [
  { slotKind: 'mandatory', slotIndex: 1, subjectId: 'history', maxPoints: 20, questionCount: 20 },
  { slotKind: 'mandatory', slotIndex: 2, subjectId: 'reading', maxPoints: 10, questionCount: 10 },
  { slotKind: 'mandatory', slotIndex: 3, subjectId: 'mlit', maxPoints: 10, questionCount: 10 },
  { slotKind: 'profile', slotIndex: 1, subjectId: null, maxPoints: 50, questionCount: 40 },
  { slotKind: 'profile', slotIndex: 2, subjectId: null, maxPoints: 50, questionCount: 40 },
];

function fullBank(): Map<string, MockCandidate[]> {
  return new Map([
    ['history', pool('history', 30)],
    ['reading', pool('reading', 20)],
    ['mlit', pool('mlit', 20)],
    ['math', pool('math', 60)],
    ['physics', pool('physics', 60)],
    ['chemistry', pool('chemistry', 60)],
  ]);
}

describe('сборка пробника', () => {
  it('набирает ровно столько заданий, сколько требует чертёж', () => {
    const mock = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['math', 'physics'],
      seed: 'ученик-1',
    });

    expect(mock.questionIds).toHaveLength(20 + 10 + 10 + 40 + 40);
    expect(mock.shortfall).toEqual([]);
  });

  it('профильные секции занимают предметы ученика по порядку выбора', () => {
    const mock = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['chemistry', 'math'],
      seed: 'ученик-1',
    });

    const profile = mock.sections.filter((section) => section.slotKind === 'profile');
    expect(profile.map((section) => section.subjectId)).toEqual(['chemistry', 'math']);
  });

  it('у разных пар предметов обязательные секции те же, а профильные — разные', () => {
    const first = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['math', 'physics'],
      seed: 'ученик-1',
    });
    const second = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['chemistry', 'math'],
      seed: 'ученик-1',
    });

    const mandatory = (mock: typeof first): string[] =>
      mock.sections.filter((s) => s.slotKind === 'mandatory').flatMap((s) => [...s.questionIds]);

    expect(mandatory(second)).toEqual(mandatory(first));
    expect(second.sections.find((s) => s.slotKind === 'profile')?.subjectId).not.toBe(
      first.sections.find((s) => s.slotKind === 'profile')?.subjectId,
    );
  });

  it('не повторяет задание в двух секциях', () => {
    const sections: BlueprintSection[] = [
      { slotKind: 'mandatory', slotIndex: 1, subjectId: 'math', maxPoints: 400, questionCount: 5 },
      { slotKind: 'profile', slotIndex: 1, subjectId: null, maxPoints: 100, questionCount: 5 },
    ];

    const mock = assembleMock({
      sections,
      candidates: new Map([['math', pool('math', 8)]]),
      profileSubjectIds: ['math'],
      seed: 'ученик-1',
    });

    expect(new Set(mock.questionIds).size).toBe(mock.questionIds.length);
    expect(mock.questionIds).toHaveLength(8);
    expect(mock.shortfall).toHaveLength(1);
  });

  it('один и тот же ученик получает тот же набор', () => {
    const first = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['math', 'physics'],
      seed: 'ученик-1',
    });
    const again = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['math', 'physics'],
      seed: 'ученик-1',
    });

    expect(again.questionIds).toEqual(first.questionIds);
  });

  it('у разных учеников наборы различаются', () => {
    const first = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['math', 'physics'],
      seed: 'ученик-1',
    });
    const second = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['math', 'physics'],
      seed: 'ученик-2',
    });

    expect(second.questionIds).not.toEqual(first.questionIds);
  });

  it('раскладывает задания по сложности, а не берёт подряд лёгкие', () => {
    const sections: BlueprintSection[] = [
      { slotKind: 'mandatory', slotIndex: 1, subjectId: 'math', maxPoints: 10, questionCount: 5 },
    ];

    const mock = assembleMock({
      sections,
      candidates: new Map([['math', pool('math', 50)]]),
      profileSubjectIds: [],
      seed: 'ученик-1',
    });

    const picked = new Set(
      mock.questionIds.map((id) => Number(id.split('-')[1] ?? 0) % 5),
    );

    expect(picked.size).toBeGreaterThan(1);
  });

  it('называет недобор по секциям, а не выдаёт огрызок за настоящий тест', () => {
    const mock = assembleMock({
      sections: ENT_SECTIONS,
      candidates: new Map([
        ['history', pool('history', 5)],
        ['reading', pool('reading', 10)],
        ['mlit', pool('mlit', 10)],
        ['math', pool('math', 40)],
        ['physics', pool('physics', 12)],
      ]),
      profileSubjectIds: ['math', 'physics'],
      seed: 'ученик-1',
    });

    expect(mock.shortfall).toHaveLength(2);
    expect(mock.shortfall.find((item) => item.subjectId === 'history')).toMatchObject({
      requested: 20,
      available: 5,
    });
    expect(mock.shortfall.find((item) => item.subjectId === 'physics')).toMatchObject({
      requested: 40,
      available: 12,
    });
  });

  it('пропускает профильную секцию, которой не досталось предмета', () => {
    const mock = assembleMock({
      sections: ENT_SECTIONS,
      candidates: fullBank(),
      profileSubjectIds: ['math'],
      seed: 'ученик-1',
    });

    expect(mock.sections.filter((section) => section.slotKind === 'profile')).toHaveLength(1);
  });

  it('пустой банк не роняет сборку', () => {
    const mock = assembleMock({
      sections: ENT_SECTIONS,
      candidates: new Map(),
      profileSubjectIds: ['math', 'physics'],
      seed: 'ученик-1',
    });

    expect(mock.questionIds).toEqual([]);
    expect(mock.shortfall).toHaveLength(5);
  });
});

describe('приведение к шкале экзамена', () => {
  it('переводит набранное в баллы секции', () => {
    const [section] = scaleSections([
      {
        slotKind: 'mandatory',
        slotIndex: 1,
        subjectId: 'history',
        pointsEarned: 8,
        pointsPossible: 10,
        maxPoints: 20,
      },
    ]);

    expect(section?.scaled).toBe(16);
  });

  it('не зависит от того, сколько заданий было в секции', () => {
    const short = scaleSections([
      {
        slotKind: 'mandatory',
        slotIndex: 1,
        subjectId: 'history',
        pointsEarned: 4,
        pointsPossible: 5,
        maxPoints: 20,
      },
    ]);
    const full = scaleSections([
      {
        slotKind: 'mandatory',
        slotIndex: 1,
        subjectId: 'history',
        pointsEarned: 16,
        pointsPossible: 20,
        maxPoints: 20,
      },
    ]);

    expect(short[0]?.scaled).toBe(full[0]?.scaled);
  });

  it('пустая секция даёт ноль, а не деление на ноль', () => {
    const [section] = scaleSections([
      {
        slotKind: 'profile',
        slotIndex: 1,
        subjectId: 'math',
        pointsEarned: 0,
        pointsPossible: 0,
        maxPoints: 50,
      },
    ]);

    expect(section?.scaled).toBe(0);
  });

  it('складывает итог по шкале экзамена', () => {
    const sections = scaleSections([
      {
        slotKind: 'mandatory',
        slotIndex: 1,
        subjectId: 'history',
        pointsEarned: 10,
        pointsPossible: 20,
        maxPoints: 20,
      },
      {
        slotKind: 'profile',
        slotIndex: 1,
        subjectId: 'math',
        pointsEarned: 20,
        pointsPossible: 40,
        maxPoints: 50,
      },
    ]);

    expect(totalScaledScore(sections)).toBe(35);
  });
});
