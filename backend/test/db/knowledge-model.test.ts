import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '../../src/db/sql.js';
import {
  cleanupTestUsers,
  createTestSql,
  createTestUser,
  hasDatabase,
  topicIdByCode,
  type TestUser,
} from '../helpers/db.js';

let sql: Sql;
let student: TestUser;
const createdIds: string[] = [];

interface MasteryRow {
  mastery_pct: string;
  confidence: string;
  evidence_count: number;
  evidence_weight_sum: string;
  priority: string;
  status: string;
  is_problem: boolean;
}

async function addEvent(
  topicCode: string,
  options: {
    readonly delta: number;
    readonly baseline?: number;
    readonly weight?: number;
    readonly sourceId?: string | null;
    readonly sourceType?: string;
  },
): Promise<void> {
  const { topicId, subjectId } = await topicIdByCode(sql, topicCode);
  await sql`
    insert into public.stat_events (
      student_id, topic_id, subject_id, source_type, source_id,
      delta_pct, baseline_pct, evidence_weight, reason
    ) values (
      ${student.id}, ${topicId}, ${subjectId},
      ${options.sourceType ?? 'attempt'}::public.stat_source_type,
      ${options.sourceId === undefined ? sql`gen_random_uuid()` : options.sourceId},
      ${options.delta}, ${options.baseline ?? null}, ${options.weight ?? 1.0},
      'проверка модели знаний'
    )
  `;
}

async function mastery(topicCode: string): Promise<MasteryRow> {
  const { topicId } = await topicIdByCode(sql, topicCode);
  const [row] = await sql<MasteryRow[]>`
    select mastery_pct, confidence, evidence_count, evidence_weight_sum,
           priority, status::text, is_problem
      from public.student_topic_mastery
     where student_id = ${student.id} and topic_id = ${topicId}
  `;
  if (row === undefined) {
    throw new Error(`нет записи мастерства по теме ${topicCode}`);
  }
  return row;
}

describe.skipIf(!hasDatabase())('модель знаний', () => {
  beforeAll(async () => {
    sql = createTestSql();
    student = await createTestUser(sql, 'student');
    createdIds.push(student.id);
  });

  afterAll(async () => {
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  it('первое событие создаёт запись, отталкиваясь от переданной базы', async () => {
    await addEvent('math.trigonometry', { delta: 20, baseline: 30 });
    const row = await mastery('math.trigonometry');

    expect(Number(row.mastery_pct)).toBe(50);
    expect(row.evidence_count).toBe(1);
    expect(row.status).toBe('improving');
  });

  it('уверенность растёт с числом свидетельств, а не появляется сразу', async () => {
    const first = await mastery('math.trigonometry');
    expect(Number(first.confidence)).toBeCloseTo(0.2, 2);

    await addEvent('math.trigonometry', { delta: 5 });
    await addEvent('math.trigonometry', { delta: 5 });
    const third = await mastery('math.trigonometry');

    expect(Number(third.evidence_weight_sum)).toBeCloseTo(3, 2);
    expect(Number(third.confidence)).toBeCloseTo(0.6, 2);
  });

  it('последующие события накапливаются от текущего значения', async () => {
    const row = await mastery('math.trigonometry');
    expect(Number(row.mastery_pct)).toBe(60);
    expect(row.evidence_count).toBe(3);
  });

  it('приоритет убывает по мере роста мастерства', async () => {
    const before = await mastery('math.trigonometry');
    await addEvent('math.trigonometry', { delta: 25 });
    const after = await mastery('math.trigonometry');

    expect(Number(after.mastery_pct)).toBeGreaterThan(Number(before.mastery_pct));
    expect(Number(after.priority)).toBeLessThan(Number(before.priority));
  });

  it('мастерство не выходит за 100 и тема покидает список проблемных', async () => {
    await addEvent('math.derivative', { delta: 25, baseline: 90 });
    await addEvent('math.derivative', { delta: 25 });

    const row = await mastery('math.derivative');

    expect(Number(row.mastery_pct)).toBe(100);
    expect(row.status).toBe('mastered');

    expect(row.is_problem).toBe(false);
    expect(Number(row.priority)).toBe(0);
  });

  it('освоенная тема исчезает из представления проблемных тем', async () => {
    const { topicId } = await topicIdByCode(sql, 'math.derivative');
    const rows = await sql<{ topic_id: string }[]>`
      select topic_id from public.v_student_weak_topics
       where student_id = ${student.id} and topic_id = ${topicId}
    `;

    expect(rows).toEqual([]);
  });

  it('мастерство не опускается ниже нуля', async () => {
    await addEvent('math.integral', { delta: -25, baseline: 10 });
    const row = await mastery('math.integral');

    expect(Number(row.mastery_pct)).toBe(0);
    expect(row.status).toBe('weak');
    expect(row.is_problem).toBe(true);
  });

  it('дельта за границами контракта отвергается базой', async () => {
    await expect(addEvent('math.progressions', { delta: 40 })).rejects.toThrow(
      /stat_events_delta_pct_check|violates check constraint/i,
    );
  });

  it('повторное событие из того же источника отвергается — защита от дублей', async () => {
    const sourceId = '11111111-2222-3333-4444-555555555555';

    await addEvent('math.probability', { delta: 10, baseline: 40, sourceId });
    const afterFirst = await mastery('math.probability');

    await expect(
      addEvent('math.probability', { delta: 10, sourceId }),
    ).rejects.toThrow(/stat_events_dedupe_idx|duplicate key/i);

    const afterSecond = await mastery('math.probability');
    expect(Number(afterSecond.mastery_pct)).toBe(Number(afterFirst.mastery_pct));
    expect(afterSecond.evidence_count).toBe(afterFirst.evidence_count);
  });

  it('тот же источник по другой теме событию не мешает', async () => {
    const sourceId = '11111111-2222-3333-4444-555555555555';
    await expect(
      addEvent('math.combinatorics', { delta: 10, baseline: 50, sourceId }),
    ).resolves.toBeUndefined();
  });

  it('агрегат по предмету пересчитывается и учитывает вес темы', async () => {
    const [row] = await sql<{ mastery_pct: string; topics_total: number; topics_mastered: number }[]>`
      select ssm.mastery_pct, ssm.topics_total, ssm.topics_mastered
        from public.student_subject_mastery ssm
        join public.subjects s on s.id = ssm.subject_id
       where ssm.student_id = ${student.id} and s.code = 'math'
    `;

    expect(row).toBeDefined();
    expect(row?.topics_total).toBeGreaterThanOrEqual(4);
    expect(row?.topics_mastered).toBe(1);

    const [expected] = await sql<{ expected: string }[]>`
      select round(
               sum(m.mastery_pct * coalesce(t.exam_weight, 1))
               / nullif(sum(coalesce(t.exam_weight, 1)), 0), 2) as expected
        from public.student_topic_mastery m
        join public.topics t on t.id = m.topic_id
        join public.subjects s on s.id = m.subject_id
       where m.student_id = ${student.id} and s.code = 'math'
    `;

    expect(Number(row?.mastery_pct)).toBeCloseTo(Number(expected?.expected), 2);
  });

  it('журнал сохраняет всю историю изменений', async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.stat_events where student_id = ${student.id}
    `;

    expect(row?.n ?? 0).toBeGreaterThanOrEqual(8);
  });

  it('проекция восстановима: пересчёт из журнала даёт то же значение', async () => {
    const { topicId } = await topicIdByCode(sql, 'math.trigonometry');

    const [projection] = await sql<{ mastery_pct: string }[]>`
      select mastery_pct from public.student_topic_mastery
       where student_id = ${student.id} and topic_id = ${topicId}
    `;

    const events = await sql<{ delta_pct: string; baseline_pct: string | null }[]>`
      select delta_pct, baseline_pct from public.stat_events
       where student_id = ${student.id} and topic_id = ${topicId}
       order by created_at, id
    `;

    let value = 0;
    let first = true;
    for (const event of events) {
      if (first) {
        value = Number(event.baseline_pct ?? 0);
        first = false;
      }
      value = Math.min(100, Math.max(0, value + Number(event.delta_pct)));
    }

    expect(Number(projection?.mastery_pct)).toBeCloseTo(value, 2);
  });
});
