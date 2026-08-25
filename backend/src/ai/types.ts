import type { JsonObject } from '../contracts/json.js';
import type { AiOpType } from '../queue/jobs.js';




export interface PromptBlock {
  readonly layer: 'system_core' | 'curriculum' | 'material' | 'student' | 'operation';
  readonly text: string;
  
  readonly cacheable: boolean;
}

export interface ResponseSchema {
  readonly name: string;
  readonly schema: JsonObject;
}

export interface ModelRequest {
  readonly opType: AiOpType;
  readonly blocks: readonly PromptBlock[];
  readonly schema: ResponseSchema;
  readonly temperature: number;
  readonly maxTokens: number;
  
  readonly repairHint?: string;
}

export interface TokenUsage {
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
}

export interface ModelResponse {
  readonly text: string;
  readonly stopReason: string | null;
  readonly model: string;
  readonly usage: TokenUsage;
  readonly requestId: string | null;
  readonly latencyMs: number;
  readonly httpStatus: number;
}

export interface ModelCaller {
  call(request: ModelRequest): Promise<ModelResponse>;
  modelFor(opType: AiOpType): string;
}


export type ModelFailureKind =
  
  | 'transient'
  
  | 'permanent'
  
  | 'refusal'
  
  | 'truncated'
  
  | 'empty';

export class ModelError extends Error {
  readonly kind: ModelFailureKind;
  readonly httpStatus: number | null;
  readonly code: string;
  readonly retryAfterMs: number | null;

  constructor(
    kind: ModelFailureKind,
    message: string,
    options: {
      readonly httpStatus?: number | null;
      readonly code?: string;
      readonly retryAfterMs?: number | null;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = 'ModelError';
    this.kind = kind;
    this.httpStatus = options.httpStatus ?? null;
    this.code = options.code ?? kind.toUpperCase();
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  static is(value: unknown): value is ModelError {
    return value instanceof ModelError;
  }
}
