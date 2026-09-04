import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '../../src/db/sql.js';
import { enqueueJob } from '../../src/queue/jobs.js';
import { createTestSql, createTestUser, cleanupTestUsers, hasDatabase } from '../helpers/db.js';

let sql: Sql;
const createdIds: string[] = [];

beforeAll(async () => {
  if (!hasDatabase()) return;

  sql = createTestSql();
});

afterAll(async () => {
  if (!hasDatabase()) return;
  await cleanupTestUsers(sql, createdIds);
  await sql.end({ timeout: 5 });
});

describe.skipIf(!hasDatabase())('нагрузка на очередь', () => {
  it('50 одновременных постановок с одним ключом дедупликации дают одну работу', async () => {
    const student = await createTestUser(sql, 'student');
    createdIds.push(student.id);

    const dedupeKey = `load-test:${student.id}`;
    const attempts = Array.from({ length: 50 }, (_, index) =>
      enqueueJob(sql, {
        opType: 'task_generation',
        requestedBy: student.id,
        studentId: student.id,
        dedupeKey,
        input: { topic_id: null, marker: index },
      }),
    );

    const results = await Promise.all(attempts);

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);

    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.ai_jobs where dedupe_key = ${dedupeKey}
    `;
    expect(row?.n).toBe(1);
  });

  it('несколько воркеров разбирают общий пул без двойного захвата', async () => {
    const student = await createTestUser(sql, 'student');
    createdIds.push(student.id);

    const total = 40;
    const stamp = Date.now();

    await Promise.all(
      Array.from({ length: total }, (_, index) =>
        enqueueJob(sql, {
          opType: 'task_generation',
          requestedBy: student.id,
          studentId: student.id,
          dedupeKey: `load-claim:${student.id}:${stamp}:${index}`,
          input: { marker: index },
        }),
      ),
    );

    const [before] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.ai_jobs where status = 'queued'
    `;
    const queuedBefore = before?.n ?? 0;
    expect(queuedBefore).toBeGreaterThanOrEqual(total);

    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, worker) =>
        sql<{ id: string }[]>`
          select id from app.claim_ai_jobs(${`load-worker-${String(worker)}`}, 10)
        `,
      ),
    );

    const claimedIds = claims.flatMap((rows) => rows.map((row) => row.id));

    expect(claimedIds.length).toBe(new Set(claimedIds).size);
    expect(claimedIds.length).toBeLessThanOrEqual(queuedBefore);
    expect(claimedIds.length).toBeGreaterThanOrEqual(total);

    const [running] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.ai_jobs
       where id = any(${claimedIds}::uuid[]) and status = 'running'
    `;

    expect(running?.n).toBe(claimedIds.length);

    const [oursLeft] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.ai_jobs
       where student_id = ${student.id} and status = 'queued'
         and dedupe_key like ${`load-claim:${student.id}:${stamp}:%`}
    `;
    expect(oursLeft?.n).toBe(0);
  });
});
