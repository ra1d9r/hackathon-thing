import type { z } from 'zod';

import type { SqlExecutor } from '../db/sql.js';
import type { AiOpType } from '../queue/jobs.js';
import { promptHash } from './prompt.js';
import { ModelError, type ModelCaller, type ModelRequest, type ModelResponse } from './types.js';




const MAX_TOKEN_GROWTH = 32_000;

export interface CallLogEntry {
  readonly attemptNo: number;
  
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly stopReason: string | null;
  readonly promptHash: string;
  readonly model: string;
  readonly usage: ModelResponse['usage'] | null;
  readonly latencyMs: number | null;
  readonly requestId: string | null;
}


export type ModelFailureReason =
  | 'invalid_output'
  | 'unavailable'
  | 'refused'
  | 'insufficient_context';

export type ValidationOutcome<T> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly calls: readonly CallLogEntry[];
      
      readonly repairedBecause: string | null;
    }
  | {
      readonly ok: false;
      readonly reason: ModelFailureReason;
      readonly message: string;
      readonly calls: readonly CallLogEntry[];
    };


function parseStrict(text: string): unknown {
  
  
  
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const payload = fenced?.[1] ?? trimmed;

  return JSON.parse(payload);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(корень)'}: ${issue.message}`)
    .join('; ');
}

export interface EnvelopeShape<T> {
  readonly insufficient_context: boolean;
  readonly data: T;
  readonly notes?: string | undefined;
}

export interface CallOptions<Schema extends z.ZodType<EnvelopeShape<unknown>>> {
  readonly caller: ModelCaller;
  readonly request: ModelRequest;
  readonly schema: Schema;
}


export async function callAndValidate<Schema extends z.ZodType<EnvelopeShape<unknown>>>(
  options: CallOptions<Schema>,
): Promise<ValidationOutcome<z.infer<Schema>['data']>> {
  const { caller, request, schema } = options;
  const hash = promptHash(request.blocks);
  const model = caller.modelFor(request.opType);
  const calls: CallLogEntry[] = [];

  let repairHint: string | undefined;
  let maxTokens = request.maxTokens;
  
  let invalidDetail: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response: ModelResponse;

    try {
      response = await caller.call({
        ...request,
        maxTokens,
        ...(repairHint === undefined ? {} : { repairHint }),
      });
    } catch (error: unknown) {
      const failure = ModelError.is(error)
        ? error
        : new ModelError('transient', 'неизвестный сбой обращения к модели', { cause: error });

      calls.push({
        attemptNo: attempt,
        ok: false,
        httpStatus: failure.httpStatus,
        errorCode: failure.code,
        stopReason: null,
        promptHash: hash,
        model,
        usage: null,
        latencyMs: null,
        requestId: null,
      });

      
      
      
      
      
      if (failure.kind === 'truncated' && attempt === 1) {
        maxTokens = Math.min(MAX_TOKEN_GROWTH, maxTokens * 2);
        invalidDetail = 'предыдущий ответ не поместился в бюджет';
        continue;
      }

      
      
      if (failure.kind === 'empty' && attempt === 1) {
        repairHint =
          'предыдущий ответ оказался пустым; весь ответ должен быть в поле content, ' +
          'а не в рассуждении';
        invalidDetail = 'пустой ответ при завершённом вызове';
        continue;
      }

      return {
        ok: false,
        reason: failure.kind === 'refusal' ? 'refused' : 'unavailable',
        message: failure.message,
        calls,
      };
    }

    const entry: CallLogEntry = {
      attemptNo: attempt,
      ok: true,
      httpStatus: response.httpStatus,
      errorCode: null,
      stopReason: response.stopReason,
      promptHash: hash,
      model: response.model,
      usage: response.usage,
      latencyMs: response.latencyMs,
      requestId: response.requestId,
    };
    calls.push(entry);

    
    const markUnusable = (code: string, detail: string): void => {
      calls[calls.length - 1] = { ...entry, ok: false, errorCode: code };
      invalidDetail = detail;
    };

    let payload: unknown;
    try {
      payload = parseStrict(response.text);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'ошибка разбора';
      markUnusable('INVALID_JSON', detail);

      if (attempt === 1) {
        repairHint = `ответ не разобрался как JSON: ${detail}`;
        continue;
      }
      return { ok: false, reason: 'invalid_output', message: 'ответ не является JSON', calls };
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const detail = describeIssues(parsed.error);
      markUnusable('INVALID_SCHEMA', detail);

      if (attempt === 1) {
        repairHint = `ответ не прошёл схему: ${detail}`;
        continue;
      }
      return {
        ok: false,
        reason: 'invalid_output',
        message: `ответ не прошёл схему: ${detail}`,
        calls,
      };
    }

    if (parsed.data.insufficient_context) {
      
      
      return {
        ok: false,
        reason: 'insufficient_context',
        message: parsed.data.notes ?? 'модели не хватило контекста',
        calls,
      };
    }

    return { ok: true, data: parsed.data.data, calls, repairedBecause: invalidDetail };
  }

  return { ok: false, reason: 'invalid_output', message: 'исчерпаны попытки разбора', calls };
}


export async function writeCallLogs(
  sql: SqlExecutor,
  jobId: string,
  opType: AiOpType,
  calls: readonly CallLogEntry[],
): Promise<void> {
  for (const call of calls) {
    await sql`
      insert into public.ai_call_logs (
        job_id, attempt_no, op_type, model, ok, http_status, error_code, stop_reason,
        prompt_hash, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
        latency_ms, request_id
      ) values (
        ${jobId}, ${call.attemptNo}, ${opType}::public.ai_op_type, ${call.model}, ${call.ok},
        ${call.httpStatus}, ${call.errorCode}, ${call.stopReason}, ${call.promptHash},
        ${call.usage?.input ?? null}, ${call.usage?.output ?? null},
        ${call.usage?.cacheRead ?? null}, ${call.usage?.cacheWrite ?? null},
        ${call.latencyMs}, ${call.requestId}
      )
    `;
  }
}
