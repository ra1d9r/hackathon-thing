import { createHash } from 'node:crypto';

import { stableStringify, type JsonObject } from '../contracts/json.js';
import { AppError } from '../contracts/errors.js';
import type { SqlExecutor } from '../db/sql.js';

export const AI_OP_TYPES = [
  'diagnostic_analysis',
  'free_text_grading',
  'attempt_analysis',
  'task_generation',
  'knowledge_check_generation',
  'roadmap_plan',
  'daily_plan',
  'predicted_score',
  'mock_analysis',
  'assistant_chat',
  'moderation',
] as const;

export type AiOpType = (typeof AI_OP_TYPES)[number];

export const AI_JOB_STATUSES = [
  'queued',
  'running',
  'awaiting_retry',
  'succeeded',
  'failed',
  'canceled',
  'dead_letter',
] as const;

export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

const TERMINAL_STATUSES: readonly AiJobStatus[] = [
  'succeeded',
  'failed',
  'canceled',
  'dead_letter',
];

export function isTerminal(status: AiJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const OP_PRIORITY: Record<AiOpType, number> = {
  assistant_chat: 5,
  moderation: 5,
  free_text_grading: 10,
  diagnostic_analysis: 10,
  attempt_analysis: 20,
  mock_analysis: 20,
  task_generation: 30,
  knowledge_check_generation: 30,
  roadmap_plan: 40,
  daily_plan: 40,
  predicted_score: 50,
};

export const dedupeKey = {
  freeTextGrading: (attemptId: string): string => `free_text_grading:${attemptId}`,
  attemptAnalysis: (attemptId: string): string => `attempt_analysis:${attemptId}`,
  diagnosticAnalysis: (attemptId: string): string => `diagnostic_analysis:${attemptId}`,
  mockAnalysis: (attemptId: string): string => `mock_analysis:${attemptId}`,

  predictedScore: (studentId: string, now = new Date()): string =>
    `predicted_score:${studentId}:${Math.floor(now.getTime() / 3_600_000)}`,
} as const;

export function hashInput(input: JsonObject): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

export interface EnqueueInput {
  readonly opType: AiOpType;
  readonly requestedBy: string;
  readonly studentId: string | null;
  readonly dedupeKey: string;
  readonly input: JsonObject;
  readonly idempotencyKey?: string | null;
  readonly dependsOnJobId?: string | null;
  readonly priority?: number;
  readonly maxAttempts?: number;
}

export interface EnqueuedJob {
  readonly id: string;
  readonly status: AiJobStatus;
  readonly opType: AiOpType;
  readonly created: boolean;
}

interface JobIdRow {
  id: string;
  status: AiJobStatus;
  op_type: AiOpType;
}

export async function enqueueJob(sql: SqlExecutor, job: EnqueueInput): Promise<EnqueuedJob> {
  const priority = job.priority ?? OP_PRIORITY[job.opType];

  const inserted = await sql<JobIdRow[]>`
    insert into public.ai_jobs (
      op_type, requested_by, student_id, priority, dedupe_key,
      idempotency_key, depends_on_job_id, input, input_hash, max_attempts
    ) values (
      ${job.opType}::public.ai_op_type,
      ${job.requestedBy},
      ${job.studentId},
      ${priority},
      ${job.dedupeKey},
      ${job.idempotencyKey ?? null},
      ${job.dependsOnJobId ?? null},
      ${sql.json(job.input)},
      ${hashInput(job.input)},
      ${job.maxAttempts ?? 5}
    )
    -- Предикат частичного индекса приходится повторить: без него Postgres
    -- не понимает, по какому именно индексу разрешать конфликт.
    on conflict (dedupe_key) where status in ('queued','running','awaiting_retry')
    do nothing
    returning id, status::text as status, op_type::text as op_type
  `;

  const created = inserted[0];
  if (created !== undefined) {
    return { id: created.id, status: created.status, opType: created.op_type, created: true };
  }

  const [existing] = await sql<JobIdRow[]>`
    select id, status::text as status, op_type::text as op_type
      from public.ai_jobs
     where dedupe_key = ${job.dedupeKey}
       and status in ('queued','running','awaiting_retry')
     limit 1
  `;

  if (existing === undefined) {
    throw new AppError('STATE_CONFLICT', {
      message: 'Операция завершилась во время постановки в очередь, повторите запрос',
    });
  }

  return { id: existing.id, status: existing.status, opType: existing.op_type, created: false };
}

export const SUGGESTED_WAIT_MS: Record<AiOpType, number> = {
  assistant_chat: 800,
  moderation: 500,
  free_text_grading: 1_500,
  diagnostic_analysis: 1_500,
  attempt_analysis: 1_500,
  mock_analysis: 2_000,
  task_generation: 2_000,
  knowledge_check_generation: 2_000,
  roadmap_plan: 3_000,
  daily_plan: 3_000,
  predicted_score: 3_000,
};

export function pollUrl(jobId: string): string {
  return `/v1/ai/jobs/${jobId}`;
}
