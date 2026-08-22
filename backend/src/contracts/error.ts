import { z } from 'zod';

import type { JsonObject } from './json.js';

export interface ErrorSpec {
  readonly status: number;
  readonly retryable: boolean;
  readonly message: string;
}

export const ERROR_CODE_VALUES = [
  'VALIDATION_FAILED',
  'UNSUPPORTED_FILE_TYPE',
  'UNAUTHENTICATED',
  'FORBIDDEN_ROLE',
  'FORBIDDEN_RESOURCE',
  'INVALID_INVITE_CODE',
  'NOT_FOUND',
  'EMAIL_TAKEN',
  'IDEMPOTENCY_KEY_REUSED',
  'ATTEMPT_ALREADY_SUBMITTED',
  'ONBOARDING_INCOMPLETE',
  'DIAGNOSTIC_REQUIRED',
  'STATE_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'AI_OUTPUT_INVALID',
  'RATE_LIMITED',
  'AI_QUOTA_EXCEEDED',
  'INTERNAL_ERROR',
  'AI_UNAVAILABLE',
  'DB_UNAVAILABLE',
  'AI_TIMEOUT',
] as const;

export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];

export const ERROR_CODES: Record<ErrorCode, ErrorSpec> = {
  // 400
  VALIDATION_FAILED: {
    status: 400,
    retryable: false,
    message: 'Запрос не прошёл проверку',
  },
  UNSUPPORTED_FILE_TYPE: {
    status: 400,
    retryable: false,
    message: 'Такой тип файла не поддерживается',
  },

  // 401 / 403
  UNAUTHENTICATED: {
    status: 401,
    retryable: false,
    message: 'Требуется вход в аккаунт',
  },
  FORBIDDEN_ROLE: {
    status: 403,
    retryable: false,
    message: 'Действие недоступно для вашей роли',
  },
  FORBIDDEN_RESOURCE: {
    status: 403,
    retryable: false,
    message: 'Нет доступа к этому ресурсу',
  },
  INVALID_INVITE_CODE: {
    status: 403,
    retryable: false,
    message: 'Неверный код приглашения',
  },

  // 404
  NOT_FOUND: {
    status: 404,
    retryable: false,
    message: 'Ресурс не найден',
  },

  // 409
  EMAIL_TAKEN: {
    status: 409,
    retryable: false,
    message: 'Такой адрес уже зарегистрирован',
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    retryable: false,
    message: 'Ключ идемпотентности уже использован с другими данными',
  },
  ATTEMPT_ALREADY_SUBMITTED: {
    status: 409,
    retryable: false,
    message: 'Попытка уже отправлена',
  },
  ONBOARDING_INCOMPLETE: {
    status: 409,
    retryable: false,
    message: 'Сначала нужно завершить первичный опрос',
  },
  DIAGNOSTIC_REQUIRED: {
    status: 409,
    retryable: false,
    message: 'Сначала нужно пройти диагностический тест',
  },
  STATE_CONFLICT: {
    status: 409,
    retryable: false,
    message: 'Состояние изменилось, повторите запрос заново',
  },

  // 413 / 422
  PAYLOAD_TOO_LARGE: {
    status: 413,
    retryable: false,
    message: 'Слишком большой объём данных',
  },
  AI_OUTPUT_INVALID: {
    status: 422,
    retryable: true,
    message: 'Ответ ИИ не прошёл проверку, попробуем ещё раз',
  },

  // 429
  RATE_LIMITED: {
    status: 429,
    retryable: true,
    message: 'Слишком много запросов, попробуйте позже',
  },
  AI_QUOTA_EXCEEDED: {
    status: 429,
    retryable: true,
    message: 'Дневной лимит обращений к ИИ исчерпан',
  },

  // 5xx
  INTERNAL_ERROR: {
    status: 500,
    retryable: true,
    message: 'Внутренняя ошибка сервера',
  },
  AI_UNAVAILABLE: {
    status: 503,
    retryable: true,
    message: 'ИИ временно недоступен',
  },
  DB_UNAVAILABLE: {
    status: 503,
    retryable: true,
    message: 'База данных временно недоступна',
  },
  AI_TIMEOUT: {
    status: 504,
    retryable: true,
    message: 'ИИ не ответил вовремя',
  },
};

export function isErrorCode(value: string): value is ErrorCode {
  return ERROR_CODE_VALUES.some((code) => code === value);
}

export interface AppErrorOptions {
  readonly message?: string;
  readonly details?: JsonObject;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: JsonObject | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const spec = ERROR_CODES[code];
    super(options.message ?? spec.message, options.cause === undefined ? {} : { cause: options.cause });

    this.name = 'AppError';
    this.code = code;
    this.status = spec.status;
    this.retryable = spec.retryable;
    this.details = options.details;
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}

export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODE_VALUES).describe('Машиночитаемый код ошибки'),
      message: z.string().describe('Текст для показа пользователю'),
      retryable: z.boolean().describe('Имеет ли смысл повторять запрос'),
      request_id: z.string().describe('Идентификатор запроса для корреляции с логами'),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .describe('Ошибка');

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function buildErrorEnvelope(
  error: AppError,
  requestId: string,
): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      request_id: requestId,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
