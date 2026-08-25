import type { FastifyBaseLogger } from 'fastify';

import { quotaExceeded } from '../ai/limits.js';
import type { AiRuntime } from '../ai/runtime.js';
import type { ModelCaller } from '../ai/types.js';
import { writeCallLogs, type CallLogEntry } from '../ai/validate.js';
import type { SupabaseAdmin } from '../auth/supabase-admin.js';
import { isJsonObject, type JsonObject } from '../contracts/json.js';
import type { Sql, SqlExecutor } from '../db/sql.js';
import { attemptAnalysis } from './handlers/analysis.js';
import { assistantChat } from './handlers/assistant-chat.js';
import { dailyPlan } from './handlers/daily-plan.js';
import { freeTextGrading } from './handlers/free-text-grading.js';
import { knowledgeCheckGeneration } from './handlers/knowledge-check.js';
import { moderation } from './handlers/moderation.js';
import { predictedScore } from './handlers/predicted-score.js';
import { roadmapPlan } from './handlers/roadmap-plan.js';
import { taskGeneration } from './handlers/task-generation.js';
import type { AiJobStatus, AiOpType } from './jobs.js';
import { runMaintenance, type MaintenanceReport } from './maintenance.js';
import {
  JobCanceledError,
  PermanentJobError,
  type ClaimedJob,
  type JobContext,
  type JobHandler,
} from './types.js';

const HANDLERS: Partial<Record<AiOpType, JobHandler>> = {
  free_text_grading: freeTextGrading,
  diagnostic_analysis: attemptAnalysis,
  attempt_analysis: attemptAnalysis,
  mock_analysis: attemptAnalysis,
  predicted_score: predictedScore,
  roadmap_plan: roadmapPlan,
  knowledge_check_generation: knowledgeCheckGeneration,
  task_generation: taskGeneration,
  daily_plan: dailyPlan,
  assistant_chat: assistantChat,
  moderation,
};

export const MAX_RETRY_DELAY_MS = 60_000;

export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_RETRY_DELAY_MS, 2 ** Math.min(attempts, 10) * 1_000);
  return Math.round(exponential * (0.5 + random() * 0.5));
}

export interface WorkerOptions {
  readonly sql: Sql;
  readonly log: FastifyBaseLogger;
  readonly workerId: string;
  readonly admin?: SupabaseAdmin | null;
  readonly ai?: AiRuntime | null;
  readonly aiRetryBudget?: number;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  readonly maintenanceIntervalMs?: number;
  readonly maintenance?: boolean;
}

interface ClaimedRow {
  id: string;
  op_type: AiOpType;
  requested_by: string;
  student_id: string | null;
  input: unknown;
  attempts: number;
  max_attempts: number;
}

interface JobStateRow {
  status: AiJobStatus;
  applied_at: Date | null;
  result: unknown;
  started_at: Date | null;
}

export class QueueWorker {
  private readonly sql: Sql;
  private readonly log: FastifyBaseLogger;
  private readonly workerId: string;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly maintenanceIntervalMs: number;
  private readonly admin: SupabaseAdmin | null;
  private readonly maintenanceEnabled: boolean;
  private readonly ai: AiRuntime | null;
  private readonly aiRetryBudget: number;

  private running = false;
  private loop: Promise<void> | null = null;
  private wakeUp: (() => void) | null = null;
  private lastMaintenanceAt = 0;

  constructor(options: WorkerOptions) {
    this.sql = options.sql;
    this.log = options.log;
    this.workerId = options.workerId;
    this.batchSize = options.batchSize ?? 5;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.maintenanceIntervalMs = options.maintenanceIntervalMs ?? 60_000;
    this.admin = options.admin ?? null;
    this.maintenanceEnabled = options.maintenance ?? true;
    this.ai = options.ai ?? null;
    this.aiRetryBudget = options.aiRetryBudget ?? 2;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wakeUp?.();
    await this.loop;
    this.loop = null;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        const claimed = await this.tick();
        if (claimed === 0) {
          await this.sleep(this.pollIntervalMs);
        }
      } catch (error: unknown) {
        this.log.error({ err: error }, 'сбой цикла очереди');
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  async tick(): Promise<number> {
    await this.maybeRunMaintenance();

    const claimed = await this.claim();
    for (const job of claimed) {
      await this.execute(job);
    }
    return claimed.length;
  }

  private async maybeRunMaintenance(): Promise<void> {
    if (!this.maintenanceEnabled) {
      return;
    }

    const now = Date.now();
    if (now - this.lastMaintenanceAt < this.maintenanceIntervalMs) {
      return;
    }
    this.lastMaintenanceAt = now;

    try {
      const report = await runMaintenance(this.sql, this.log, { admin: this.admin });
      if (hasWork(report)) {
        this.log.info({ maintenance: report }, 'обслуживание очереди');
      }
    } catch (error: unknown) {
      this.log.error({ err: error }, 'обслуживание очереди не выполнено');
    }
  }

  private async claim(): Promise<ClaimedJob[]> {
    const rows = await this.sql<ClaimedRow[]>`
      select id, op_type::text as op_type, requested_by, student_id, input, attempts, max_attempts
        from app.claim_ai_jobs(${this.workerId}, ${this.batchSize})
    `;

    return rows.map((row) => ({
      id: row.id,
      opType: row.op_type,
      requestedBy: row.requested_by,
      studentId: row.student_id,
      input: row.input,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    }));
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const handler = HANDLERS[job.opType];

    if (handler === undefined) {
      await this.fail(
        job,
        new PermanentJobError(`обработчик операции ${job.opType} не зарегистрирован`, 'NO_HANDLER'),
      );
      return;
    }

    const startedAt = Date.now();

    try {
      await handler(this.context(job, startedAt));
    } catch (error: unknown) {
      if (error instanceof JobCanceledError) {
        this.log.info({ job_id: job.id }, 'работа отменена во время выполнения');
        return;
      }
      await this.fail(job, error);
    }
  }

  private context(job: ClaimedJob, startedAt: number): JobContext {
    return {
      sql: this.sql,
      job,
      log: this.log,
      applyOnce: async (effect) => this.applyOnce(job, effect, startedAt),
      model: async () => this.modelFor(job),
      logCalls: async (calls) => this.logCalls(job, calls),
      
      
      retryOnModelOutage: () =>
        job.attempts + 1 < Math.min(this.aiRetryBudget, job.maxAttempts - 1),
    };
  }

  private async modelFor(job: ClaimedJob): Promise<ModelCaller | null> {
    if (this.ai === null) {
      return null;
    }

    if (await quotaExceeded(this.sql, job.studentId, this.ai.dailyQuota)) {
      this.log.info(
        { job_id: job.id, student_id: job.studentId },
        'суточная квота обращений к модели исчерпана, применяется расчёт',
      );
      return null;
    }

    return this.ai.caller;
  }

  private async logCalls(job: ClaimedJob, calls: readonly CallLogEntry[]): Promise<void> {
    if (calls.length === 0) {
      return;
    }
    const offset = job.attempts * 2;

    try {
      await writeCallLogs(
        this.sql,
        job.id,
        job.opType,
        calls.map((call) => ({ ...call, attemptNo: call.attemptNo + offset })),
      );
    } catch (error: unknown) {
      this.log.warn({ err: error, job_id: job.id }, 'журнал вызовов модели не записан');
    }
  }

  private async applyOnce(
    job: ClaimedJob,
    effect: (tx: SqlExecutor) => Promise<JsonObject>,
    startedAt: number,
  ): Promise<JsonObject> {
    return this.sql.begin(async (tx) => {
      const [state] = await tx<JobStateRow[]>`
        select status::text as status, applied_at, result, started_at
          from public.ai_jobs where id = ${job.id} for update
      `;

      if (state === undefined) {
        throw new PermanentJobError('работа удалена', 'JOB_GONE');
      }
      if (state.status === 'canceled') {
        throw new JobCanceledError();
      }
      if (state.applied_at !== null) {
        return isJsonObject(state.result) ? state.result : {};
      }

      const result = await effect(tx);

      await tx`
        update public.ai_jobs
           set status      = 'succeeded',
               result      = ${tx.json(result)},
               applied_at  = now(),
               finished_at = now(),
               error       = null,
               latency_ms  = ${Date.now() - startedAt}
         where id = ${job.id}
      `;

      return result;
    });
  }

  private async fail(job: ClaimedJob, error: unknown): Promise<void> {
    const permanent = error instanceof PermanentJobError;
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof PermanentJobError ? error.code : 'TRANSIENT';

    const attempts = job.attempts + 1;
    const exhausted = attempts >= job.maxAttempts;
    const status: AiJobStatus = permanent ? 'failed' : exhausted ? 'dead_letter' : 'awaiting_retry';

    this.log.warn(
      { job_id: job.id, op_type: job.opType, status, attempt: attempts, err: error },
      'работа очереди не выполнена',
    );

    await this.sql`
      update public.ai_jobs
         set status      = ${status}::public.ai_job_status,
             attempts    = ${attempts},
             locked_by   = null,
             locked_at   = null,
             error       = ${this.sql.json({ code, message })},
             run_after   = now() + make_interval(secs => ${retryDelayMs(attempts) / 1000}),
             finished_at = ${status === 'awaiting_retry' ? null : new Date()}
       where id = ${job.id}
    `;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeUp = null;
        resolve();
      }, ms);
      timer.unref();

      this.wakeUp = () => {
        clearTimeout(timer);
        this.wakeUp = null;
        resolve();
      };
    });
  }
}

function hasWork(report: MaintenanceReport): boolean {
  return (
    report.reclaimed > 0 ||
    report.autoSubmitted > 0 ||
    report.idempotencyKeysRemoved > 0 ||
    report.orphanFilesRemoved > 0 ||
    report.prioritiesRefreshed > 0
  );
}
