import { requireEnv, type Env } from '../env.js';
import { isJsonObject, type JsonValue } from '../contracts/json.js';
import type { AiOpType } from '../queue/jobs.js';
import {
  ModelError,
  type ModelCaller,
  type ModelRequest,
  type ModelResponse,
  type PromptBlock,
  type TokenUsage,
} from './types.js';



const JSON_MIME = 'application/json';

interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}


function toMessages(blocks: readonly PromptBlock[], repairHint: string | undefined): ChatMessage[] {
  const stable = blocks.filter((block) => block.cacheable).map((block) => block.text);
  const volatile = blocks.filter((block) => !block.cacheable).map((block) => block.text);

  if (repairHint !== undefined) {
    volatile.push(
      [
        'Предыдущий ответ не прошёл проверку.',
        `Причина: ${repairHint}`,
        'Верни только корректный JSON заданной формы, без пояснений и без разметки.',
      ].join('\n'),
    );
  }

  return [
    { role: 'system', content: stable.join('\n\n') },
    { role: 'user', content: volatile.join('\n\n') },
  ];
}

function numberOrNull(value: JsonValue | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

function readUsage(payload: unknown): TokenUsage {
  if (!isJsonObject(payload) || !isJsonObject(payload['usage'])) {
    return { input: null, output: null, cacheRead: null, cacheWrite: null };
  }

  const usage = payload['usage'];

  return {
    input: numberOrNull(usage['prompt_tokens']),
    output: numberOrNull(usage['completion_tokens']),
    
    cacheRead:
      numberOrNull(usage['prompt_cache_hit_tokens']) ?? numberOrNull(usage['cache_read_input_tokens']),
    cacheWrite:
      numberOrNull(usage['prompt_cache_miss_tokens']) ??
      numberOrNull(usage['cache_creation_input_tokens']),
  };
}

function readChoice(payload: unknown): { text: string; stopReason: string | null } {
  if (!isJsonObject(payload) || !Array.isArray(payload['choices'])) {
    throw new ModelError('transient', 'ответ провайдера не содержит choices');
  }

  const [choice] = payload['choices'];
  if (!isJsonObject(choice)) {
    throw new ModelError('transient', 'ответ провайдера пуст');
  }

  const stopReason = typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null;
  const message = choice['message'];
  const content = isJsonObject(message) ? message['content'] : null;

  if (typeof content !== 'string' || content.trim() === '') {
    
    
    
    if (stopReason === 'length') {
      throw new ModelError('truncated', 'бюджет токенов исчерпан рассуждением', {
        code: 'MAX_TOKENS',
      });
    }
    
    
    throw new ModelError('empty', 'ответ провайдера пуст при завершённом вызове', {
      code: 'EMPTY_CONTENT',
    });
  }

  return { text: content, stopReason };
}


function classify(status: number, body: string, retryAfterMs: number | null): ModelError {
  const short = body.slice(0, 300);

  if (status === 401 || status === 403) {
    return new ModelError('permanent', `провайдер отверг ключ (${status})`, {
      httpStatus: status,
      code: 'AUTH',
    });
  }
  if (status === 400 || status === 404 || status === 422) {
    return new ModelError('permanent', `запрос отвергнут провайдером (${status}): ${short}`, {
      httpStatus: status,
      code: 'BAD_REQUEST',
    });
  }
  if (status === 429) {
    return new ModelError('transient', 'провайдер ограничил частоту запросов', {
      httpStatus: status,
      code: 'RATE_LIMITED',
      retryAfterMs,
    });
  }

  return new ModelError('transient', `провайдер ответил ${status}: ${short}`, {
    httpStatus: status,
    code: 'UPSTREAM',
  });
}

function retryAfterFrom(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

export function createModelCaller(env: Env): ModelCaller {
  const apiKey = requireEnv(env, 'AI_API_KEY', 'обращение к модели');
  const baseUrl = env.AI_BASE_URL.replace(/\/+$/u, '');
  const overrides = env.AI_MODEL_OVERRIDES;
  const maxOutputTokens = env.AI_MAX_OUTPUT_TOKENS;

  
  const responseFormat = (request: ModelRequest): { response_format?: unknown } => {
    switch (env.AI_RESPONSE_FORMAT) {
      case 'json_object':
        return { response_format: { type: 'json_object' } };
      case 'json_schema':
        return {
          response_format: {
            type: 'json_schema',
            json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema },
          },
        };
      case 'none':
        return {};
    }
  };

  const modelFor = (opType: AiOpType): string => overrides[opType] ?? env.AI_MODEL;

  return {
    modelFor,

    async call(request: ModelRequest): Promise<ModelResponse> {
      const model = modelFor(request.opType);
      const startedAt = Date.now();

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, env.AI_TIMEOUT_MS);

      let response: Response;

      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': JSON_MIME,
            accept: JSON_MIME,
          },
          body: JSON.stringify({
            model,
            messages: toMessages(request.blocks, request.repairHint),
            temperature: request.temperature,
            max_tokens: Math.min(request.maxTokens, maxOutputTokens),
            ...responseFormat(request),
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (error: unknown) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        throw new ModelError(
          'transient',
          aborted ? 'провайдер не ответил вовремя' : 'не удалось обратиться к провайдеру',
          { code: aborted ? 'TIMEOUT' : 'NETWORK', cause: error },
        );
      } finally {
        clearTimeout(timer);
      }

      const latencyMs = Date.now() - startedAt;
      const requestId = response.headers.get('x-request-id');

      if (!response.ok) {
        throw classify(response.status, await response.text(), retryAfterFrom(response.headers));
      }

      const payload: unknown = await response.json().catch((error: unknown) => {
        throw new ModelError('transient', 'ответ провайдера не разобрался как JSON', {
          httpStatus: response.status,
          cause: error,
        });
      });

      const { text, stopReason } = readChoice(payload);

      if (stopReason === 'content_filter') {
        throw new ModelError('refusal', 'модель отказалась отвечать', {
          httpStatus: response.status,
          code: 'REFUSAL',
        });
      }
      if (stopReason === 'length') {
        throw new ModelError('truncated', 'ответ обрезан лимитом токенов', {
          httpStatus: response.status,
          code: 'MAX_TOKENS',
        });
      }

      return {
        text,
        stopReason,
        model,
        usage: readUsage(payload),
        requestId,
        latencyMs,
        httpStatus: response.status,
      };
    },
  };
}
