import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '../../src/db/sql.js';
import {
  cleanupTestUsers,
  createTestSql,
  createTestUser,
  hasDatabase,
  type TestUser,
} from '../helpers/db.js';

let sql: Sql;
let user: TestUser;
const createdIds: string[] = [];

interface JobRow {
  id: string;
  status: string;
  attempts: number;
  locked_by: string | null;
  run_after: Date;
}

async function enqueue(
  dedupeKey: string,
  options: {
    readonly priority?: number;
    readonly dependsOn?: string | null;
    readonly status?: string;
  } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into public.ai_jobs (
      op_type, status, requested_by, student_id, priority,
      dedupe_key, depends_on_job_id, input, input_hash
    ) values (
      'task_generation',
      ${options.status ?? 'queued'}::public.ai_job_status,
      ${user.id}, ${user.id}, ${options.priority ?? 100},
      ${dedupeKey}, ${options.dependsOn ?? null},
      '{"topic":"test"}'::jsonb, ${`hash-${dedupeKey}`}
    )
    returning id
  `;
  if (row === undefined) {
    throw new Error('задача не создана');
  }
  return row.id;
}

async function claim(limit = 20): Promise<JobRow[]> {
  return sql<JobRow[]>`
    select id, status::text, attempts, locked_by, run_after
      from app.claim_ai_jobs(${'worker-test'}, ${limit})
  `;
}

describe.skipIf(!hasDatabase())('очередь операций ИИ', () => {
  beforeAll(async () => {
    sql = createTestSql();
    user = await createTestUser(sql, 'student');
    createdIds.push(user.id);
  });

  afterAll(async () => {
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  it('вторая активная задача с тем же ключом не создаётся', async () => {
    const key = `dedupe-${Date.now()}`;
    await enqueue(key);

    await expect(enqueue(key)).rejects.toThrow(/ai_jobs_active_dedupe_idx|duplicate key/i);
  });

  it('после завершения задачи тот же ключ снова свободен', async () => {
    const key = `reusable-${Date.now()}`;
    const first = await enqueue(key);

    await sql`
      update public.ai_jobs
         set status = 'succeeded', result = '{"ok":true}'::jsonb, applied_at = now()
       where id = ${first}
    `;

    await expect(enqueue(key)).resolves.toBeTypeOf('string');
  });

  it('успешная задача обязана иметь результат', async () => {
    const id = await enqueue(`no-result-${Date.now()}`);

    await expect(
      sql`update public.ai_jobs set status = 'succeeded' where id = ${id}`,
    ).rejects.toThrow(/ai_jobs_terminal_consistency|violates check constraint/i);
  });

  it('захват помечает задачу выполняемой и фиксирует исполнителя', async () => {
    const id = await enqueue(`claim-${Date.now()}`);
    const claimed = await claim();

    const mine = claimed.find((job) => job.id === id);
    expect(mine).toBeDefined();
    expect(mine?.status).toBe('running');
    expect(mine?.locked_by).toBe('worker-test');
  });

  it('повторный захват уже взятую задачу не выдаёт', async () => {
    const id = await enqueue(`claim-once-${Date.now()}`);

    const firstRound = await claim();
    const secondRound = await claim();

    expect(firstRound.some((job) => job.id === id)).toBe(true);
    expect(secondRound.some((job) => job.id === id)).toBe(false);
  });

  it('зависимая задача не берётся, пока не выполнена предыдущая', async () => {
    const stamp = Date.now();
    const parent = await enqueue(`parent-${stamp}`);
    const child = await enqueue(`child-${stamp}`, { dependsOn: parent });

    const beforeParentDone = await claim();
    expect(beforeParentDone.some((job) => job.id === child)).toBe(false);

    await sql`
      update public.ai_jobs
         set status = 'succeeded', result = '{"ok":true}'::jsonb
       where id = ${parent}
    `;

    const afterParentDone = await claim();
    expect(afterParentDone.some((job) => job.id === child)).toBe(true);
  });

  it('неудача предшественника не блокирует зависимую задачу навсегда', async () => {
    const stamp = Date.now();
    const parent = await enqueue(`failed-parent-${stamp}`);
    const child = await enqueue(`orphan-child-${stamp}`, { dependsOn: parent });

    await sql`
      update public.ai_jobs
         set status = 'dead_letter', error = '{"code":"TRANSIENT"}'::jsonb
       where id = ${parent}
    `;

    const claimed = await claim();
    expect(claimed.some((job) => job.id === child)).toBe(true);
  });

  it('при нехватке мест берётся интерактивная задача, а не фоновая', async () => {
    const stamp = Date.now();
    await enqueue(`bg-pick-${stamp}`, { priority: 100 });
    const interactive = await enqueue(`fg-pick-${stamp}`, { priority: 1 });

    const claimed = await claim(1);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(interactive);
  });

  it('пачка выдаётся воркеру в порядке приоритета', async () => {
    const stamp = Date.now();
    const background = await enqueue(`bg-order-${stamp}`, { priority: 100 });
    const interactive = await enqueue(`fg-order-${stamp}`, { priority: 2 });

    const claimed = await claim();
    const positions = claimed.map((job) => job.id);

    expect(positions.indexOf(interactive)).toBeGreaterThanOrEqual(0);
    expect(positions.indexOf(background)).toBeGreaterThan(positions.indexOf(interactive));
  });

  it('задача не берётся раньше времени повторной попытки', async () => {
    const id = await enqueue(`delayed-${Date.now()}`, { status: 'awaiting_retry' });
    await sql`update public.ai_jobs set run_after = now() + interval '1 hour' where id = ${id}`;

    const claimed = await claim();
    expect(claimed.some((job) => job.id === id)).toBe(false);
  });

  it('зависшая задача возвращается в очередь с отложенным повтором', async () => {
    const id = await enqueue(`stale-${Date.now()}`);
    await sql`
      update public.ai_jobs
         set status = 'running', locked_by = 'worker-dead', locked_at = now() - interval '30 minutes'
       where id = ${id}
    `;

    await sql`select app.reclaim_stale_jobs()`;

    const [row] = await sql<JobRow[]>`
      select id, status::text, attempts, locked_by, run_after
        from public.ai_jobs where id = ${id}
    `;

    expect(row?.status).toBe('awaiting_retry');
    expect(row?.attempts).toBe(1);
    expect(row?.locked_by).toBeNull();
    expect(row?.run_after.getTime()).toBeGreaterThan(Date.now());
  });

  it('после исчерпания попыток задача уходит в отстойник', async () => {
    const id = await enqueue(`dead-${Date.now()}`);
    await sql`
      update public.ai_jobs
         set status = 'running', locked_by = 'worker-dead',
             locked_at = now() - interval '30 minutes',
             attempts = max_attempts - 1
       where id = ${id}
    `;

    await sql`select app.reclaim_stale_jobs()`;

    const [row] = await sql<{ status: string }[]>`
      select status::text from public.ai_jobs where id = ${id}
    `;

    expect(row?.status).toBe('dead_letter');
  });

  it('переход в конечное состояние будит ожидающие запросы через NOTIFY', async () => {
    const id = await enqueue(`notify-${Date.now()}`);

    const received = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('уведомление не пришло за 10 секунд'));
      }, 10_000);

      void sql
        .listen('ai_job_done', (payload) => {
          if (payload === id) {
            clearTimeout(timer);
            resolve(payload);
          }
        })
        .then(async () => {
          await sql`
            update public.ai_jobs
               set status = 'succeeded', result = '{"ok":true}'::jsonb
             where id = ${id}
          `;
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });

    await expect(received).resolves.toBe(id);
  });
});
