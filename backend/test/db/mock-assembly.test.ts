import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '../../src/db/sql.js';
import { assembleMock, type BlueprintSection, type MockCandidate } from '../../src/domain/mock-exam.js';
import { createTestSql, hasDatabase } from '../helpers/db.js';

let sql: Sql;

async function blueprint(examCode: string): Promise<BlueprintSection[]> {
  const rows = await sql<
    {
      slot_kind: string;
      slot_index: number;
      subject_id: string | null;
      max_points: string;
      question_count: number | null;
    }[]
  >`
    select sec.slot_kind::text, sec.slot_index, sec.subject_id,
           sec.max_points, sec.question_count
      from public.exam_sections sec
      join public.exam_profiles e on e.id = sec.exam_profile_id
     where e.code = ${examCode}
     order by sec.slot_kind, sec.slot_index
  `;

  return rows.map((row) => ({
    slotKind: row.slot_kind === 'profile' ? 'profile' : 'mandatory',
    slotIndex: row.slot_index,
    subjectId: row.subject_id,
    maxPoints: Number(row.max_points),
    questionCount: row.question_count,
  }));
}

async function candidates(examCode: string): Promise<Map<string, MockCandidate[]>> {
  const rows = await sql<
    {
      id: string;
      subject_id: string;
      topic_id: string;
      difficulty: number;
      points: string;
    }[]
  >`
    select q.id, q.subject_id, q.topic_id, q.difficulty, q.points
      from public.questions q
      join public.topics t on t.id = q.topic_id
      join public.exam_profiles e on e.code = ${examCode}
     where q.bank_pool = 'exam_mock'
       and q.is_active
       and t.is_active
       and (e.grade_min is null or t.grade_max >= e.grade_min)
       and (e.grade_max is null or t.grade_min <= e.grade_max)
     order by q.id
  `;

  const grouped = new Map<string, MockCandidate[]>();
  for (const row of rows) {
    const candidate: MockCandidate = {
      questionId: row.id,
      subjectId: row.subject_id,
      topicId: row.topic_id,
      difficulty: row.difficulty,
      points: Number(row.points),
    };
    const list = grouped.get(row.subject_id);
    if (list === undefined) {
      grouped.set(row.subject_id, [candidate]);
    } else {
      list.push(candidate);
    }
  }

  return grouped;
}

describe.skipIf(!hasDatabase())('сборка пробника на настоящем банке', () => {
  beforeAll(async () => {
    sql = createTestSql();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('банк НИШ покрывает чертёж целиком', async () => {
    const sections = await blueprint('nis');
    const mock = assembleMock({
      sections,
      candidates: await candidates('nis'),
      profileSubjectIds: [],
      seed: 'ученик-нищ',
    });

    expect(sections).toHaveLength(3);
    expect(mock.shortfall).toEqual([]);
    expect(mock.questionIds).toHaveLength(40 + 30 + 20);
  });

  it('пробник НИШ не повторяет заданий', async () => {
    const mock = assembleMock({
      sections: await blueprint('nis'),
      candidates: await candidates('nis'),
      profileSubjectIds: [],
      seed: 'ученик-нищ',
    });

    expect(new Set(mock.questionIds).size).toBe(mock.questionIds.length);
  });

  it('разные ученики получают разные наборы из одного банка', async () => {
    const sections = await blueprint('nis');
    const pool = await candidates('nis');

    const first = assembleMock({ sections, candidates: pool, profileSubjectIds: [], seed: 'ученик-1' });
    const second = assembleMock({ sections, candidates: pool, profileSubjectIds: [], seed: 'ученик-2' });

    expect(second.questionIds).not.toEqual(first.questionIds);
  });

  async function subjectIds(codes: readonly string[]): Promise<string[]> {
    const rows = await sql<{ id: string; code: string }[]>`
      select id, code from public.subjects where code = any(${[...codes]}::text[])
    `;
    return codes
      .map((code) => rows.find((row) => row.code === code)?.id)
      .filter((id): id is string => id !== undefined);
  }

  it('каждая утверждённая пара профильных предметов даёт полный пробник на 120 заданий', async () => {
    const sections = await blueprint('ent');
    const pool = await candidates('ent');

    const pairs = [
      ['math', 'physics'],
      ['math', 'informatics'],
      ['biology', 'chemistry'],
      ['chemistry', 'physics'],
    ];

    for (const pair of pairs) {
      const mock = assembleMock({
        sections,
        candidates: pool,
        profileSubjectIds: await subjectIds(pair),
        seed: `ученик-${pair.join('-')}`,
      });

      expect(mock.shortfall, `пара ${pair.join(' + ')}`).toEqual([]);
      expect(mock.questionIds, `пара ${pair.join(' + ')}`).toHaveLength(120);
      expect(new Set(mock.questionIds).size).toBe(120);
    }
  });

  it('обязательные секции у разных пар совпадают, а профильные различаются', async () => {
    const sections = await blueprint('ent');
    const pool = await candidates('ent');

    const first = assembleMock({
      sections,
      candidates: pool,
      profileSubjectIds: await subjectIds(['math', 'physics']),
      seed: 'ученик-общий',
    });
    const second = assembleMock({
      sections,
      candidates: pool,
      profileSubjectIds: await subjectIds(['biology', 'chemistry']),
      seed: 'ученик-общий',
    });

    const mandatory = (mock: typeof first): string[] =>
      mock.sections
        .filter((section) => section.slotKind === 'mandatory')
        .flatMap((section) => [...section.questionIds]);

    expect(mandatory(second)).toEqual(mandatory(first));

    const profileOf = (mock: typeof first): string[] =>
      mock.sections
        .filter((section) => section.slotKind === 'profile')
        .flatMap((section) => [...section.questionIds]);

    expect(profileOf(second)).not.toEqual(profileOf(first));
  });
});
