import type { JobStatusResponse } from '../../contracts/dto/ai-jobs.js';
import { AppError } from '../../contracts/errors.js';
import { isJsonObject } from '../../contracts/json.js';
import type { Sql } from '../../db/sql.js';
import { isTerminal, SUGGESTED_WAIT_MS, type AiJobStatus, type AiOpType } from '../../queue/jobs.js';
import type { JobNotifyHub } from '../../queue/notify.js';
import { SAFETY_POLL_MS } from '../../queue/notify.js';
import type { AuthUser } from '../../types/fastify.js';

interface JobRow {
  id: string;
  op_type: AiOpType;
  status: AiJobStatus;
  attempts: number;
  requested_by: string;
  student_id: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  applied_at: Date | null;
  input: unknown;
  result: unknown;
  error: unknown;
}

async function readJob(sql: Sql, jobId: string, user: AuthUser): Promise<JobRow> {
  const [row] = await sql<JobRow[]>`
    select id, op_type::text as op_type, status::text as status, attempts,
           requested_by, student_id, created_at, started_at, finished_at, applied_at,
           input, result, error
      from public.ai_jobs
     where id = ${jobId}
  `;

  
  
  if (row === undefined || (row.requested_by !== user.id && row.student_id !== user.id)) {
    throw new AppError('NOT_FOUND', { message: 'Операция не найдена' });
  }

  return row;
}

function errorCodeOf(error: unknown): string | null {
  if (isJsonObject(error) && typeof error['code'] === 'string') {
    return error['code'];
  }
  return null;
}

function usedFallback(result: unknown): boolean {
  return isJsonObject(result) && result['source'] === 'fallback';
}

function attemptIdOf(input: unknown): string | null {
  if (isJsonObject(input) && typeof input['attempt_id'] === 'string') {
    return input['attempt_id'];
  }
  return null;
}

function toResponse(row: JobRow): JobStatusResponse {
  const terminal = isTerminal(row.status);
  const attemptId = attemptIdOf(row.input);

  return {
    job: {
      id: row.id,
      op_type: row.op_type,
      status: row.status,
      attempts: row.attempts,
      created_at: row.created_at.toISOString(),
      started_at: row.started_at?.toISOString() ?? null,
      finished_at: row.finished_at?.toISOString() ?? null,
      applied: row.applied_at !== null,
      error_code: errorCodeOf(row.error),
    },
    result_ref:
      terminal && attemptId !== null ? { kind: 'attempt_result', attempt_id: attemptId } : null,
    fallback_applied: usedFallback(row.result),
    retry_after_ms: terminal ? null : SUGGESTED_WAIT_MS[row.op_type],
  };
}

export const MAX_CONCURRENT_WAITERS = 200;

export class WaiterGate {
  private active = 0;

  constructor(private readonly limit: number = MAX_CONCURRENT_WAITERS) {}

  get inFlight(): number {
    return this.active;
  }

  
  tryAcquire(): boolean {
    if (this.active >= this.limit) {
      return false;
    }
    this.active += 1;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}

export const jobWaiters = new WaiterGate();

export interface JobStatusOptions {
  readonly waitMs: number;
  readonly hub: JobNotifyHub | null;
  
  readonly pollIntervalMs?: number;
  
  readonly gate?: WaiterGate;
}

export async function getJobStatus(
  sql: Sql,
  user: AuthUser,
  jobId: string,
  options: JobStatusOptions,
): Promise<JobStatusResponse> {
  let row = await readJob(sql, jobId, user);

  if (isTerminal(row.status) || options.waitMs <= 0) {
    return toResponse(row);
  }

  const gate = options.gate ?? jobWaiters;

  
  
  
  
  if (!gate.tryAcquire()) {
    return toResponse(row);
  }

  try {
    const deadline = Date.now() + options.waitMs;
    const pollInterval = options.pollIntervalMs ?? SAFETY_POLL_MS;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const slice = Math.min(pollInterval, remaining);

      if (options.hub === null) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, slice).unref();
        });
      } else {
        await options.hub.wait(jobId, slice);
      }

      row = await readJob(sql, jobId, user);
      if (isTerminal(row.status)) {
        break;
      }
    }
  } finally {
    gate.release();
  }

  return toResponse(row);
}

export async function cancelJob(
  sql: Sql,
  user: AuthUser,
  jobId: string,
): Promise<{ id: string; status: AiJobStatus }> {
  const row = await readJob(sql, jobId, user);

  if (isTerminal(row.status)) {
    return { id: row.id, status: row.status };
  }

  if (row.status === 'running') {
    throw new AppError('STATE_CONFLICT', {
      message: 'Операция уже выполняется, отменить её нельзя',
    });
  }

  const [updated] = await sql<{ status: AiJobStatus }[]>`
    update public.ai_jobs
       set status = 'canceled', finished_at = now()
     where id = ${row.id} and status in ('queued','awaiting_retry')
    returning status::text as status
  `;

  return { id: row.id, status: updated?.status ?? row.status };
}
