import type { Sql } from '../../src/db/sql.js';
import type { QueueWorker } from '../../src/queue/worker.js';

const DEFAULT_TIMEOUT_MS = 60_000;

const POLL_INTERVAL_MS = 250;

interface PendingJob {
  id: string;
  op_type: string;
  status: string;
  attempts: number;
  error: unknown;
}

export interface DrainOptions {
  readonly timeoutMs?: number;
}

async function pendingJobs(sql: Sql, studentId: string): Promise<PendingJob[]> {
  return sql<PendingJob[]>`
    select id, op_type::text as op_type, status::text as status, attempts, error
      from public.ai_jobs
     where student_id = ${studentId}
       and status in ('queued','awaiting_retry')
     order by created_at
  `;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function drainJobs(
  sql: Sql,
  worker: QueueWorker,
  studentId: string,
  options: DrainOptions = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  for (;;) {
    const claimed = await worker.tick();

    const pending = await pendingJobs(sql, studentId);
    if (pending.length === 0) {
      return;
    }

    if (Date.now() >= deadline) {
      const stuck = pending
        .map(
          (job) =>
            `${job.op_type} (${job.status}, попыток ${job.attempts}` +
            `${job.error === null ? '' : `, ${JSON.stringify(job.error)}`})`,
        )
        .join('; ');
      throw new Error(`очередь не разобралась за отведённое время: ${stuck}`);
    }

    if (claimed === 0) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}
