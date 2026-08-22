import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError, buildErrorEnvelope, type ErrorCode } from '../contracts/errors.js';
import type { JsonObject, JsonValue } from '../contracts/json.js';

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN_RESOURCE';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'STATE_CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'DB_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

const validationIssueSchema = z.object({
  issue: z.object({
    path: z.array(z.union([z.string(), z.number()])).default([]),
    message: z.string().default(''),
    code: z.string().default(''),
  }),
});

function validationDetails(error: FastifyError): JsonObject | undefined {
  if (!hasZodFastifySchemaValidationErrors(error)) {
    return undefined;
  }

  const issues: JsonValue[] = [];

  for (const entry of error.validation) {
    const parsed = validationIssueSchema.safeParse(entry.params);
    if (!parsed.success) {
      continue;
    }

    const { path, message, code } = parsed.data.issue;
    issues.push({ path: path.join('.'), message, code });
  }

  return { issues };
}

function toAppError(error: unknown): AppError {
  if (AppError.is(error)) {
    return error;
  }

  if (isFastifyError(error)) {
    const details = validationDetails(error);
    if (details !== undefined) {
      return new AppError('VALIDATION_FAILED', { details, cause: error });
    }

    if (isResponseSerializationError(error)) {
      return new AppError('INTERNAL_ERROR', { cause: error });
    }

    const status = error.statusCode ?? 500;
    if (status < 500) {
      const code = codeForStatus(status);
      return new AppError(code, { cause: error });
    }
  }

  return new AppError('INTERNAL_ERROR', { cause: error });
}

function isFastifyError(error: unknown): error is FastifyError {
  return (
    error instanceof Error &&
    ('statusCode' in error || 'validation' in error || 'code' in error)
  );
}

async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);

    const logPayload = {
      err: error,
      error_code: appError.code,
      route: request.routeOptions.url ?? request.url,
      status: appError.status,
    };

    if (appError.status >= 500) {
      request.log.error(logPayload, 'необработанная ошибка запроса');
    } else {
      request.log.warn(logPayload, 'запрос отклонён');
    }

    return reply
      .status(appError.status)
      .send(buildErrorEnvelope(appError, request.id));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const appError = new AppError('NOT_FOUND', {
      details: { method: request.method, path: request.url },
    });

    return reply
      .status(appError.status)
      .send(buildErrorEnvelope(appError, request.id));
  });
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
  fastify: '5.x',
});
