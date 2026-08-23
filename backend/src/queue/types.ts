import type { FastifyBaseLogger } from 'fastify';

import type { CallLogEntry } from '../ai/validate.js';
import type { ModelCaller } from '../ai/types.js';
import type { JsonObject } from '../contracts/json.js';
import type { Sql, SqlExecutor } from '../db/sql.js';
import type { AiOpType } from './jobs.js';

export interface ClaimedJob {
  readonly id: string;
  readonly opType: AiOpType;
  readonly requestedBy: string;
  readonly studentId: string | null;
  readonly input: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface JobContext {
  readonly sql: Sql;
  readonly job: ClaimedJob;
  readonly log: FastifyBaseLogger;
  applyOnce(effect: (tx: SqlExecutor) => Promise<JsonObject>): Promise<JsonObject>;
 
  model(): Promise<ModelCaller | null>;
  logCalls(calls: readonly CallLogEntry[]): Promise<void>;

  retryOnModelOutage(): boolean;
}

export type JobHandler = (ctx: JobContext) => Promise<JsonObject>;

export class PermanentJobError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PERMANENT') {
    super(message);
    this.name = 'PermanentJobError';
    this.code = code;
  }
}

export class TransientJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientJobError';
  }
}

export class JobCanceledError extends Error {
  constructor() {
    super('Работа отменена');
    this.name = 'JobCanceledError';
  }
}
