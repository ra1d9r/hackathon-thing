import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  jobCancelResponseSchema,
  jobStatusQuerySchema,
  jobStatusResponseSchema,
} from '../../contracts/dto/ai-jobs.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import type { AuthUser } from '../../types/fastify.js';
import { cancelJob, getJobStatus } from './service.js';

function requireSql(app: FastifyInstance): Sql {
  const sql = app.sql;
  if (sql === undefined) {
    throw new AppError('DB_UNAVAILABLE');
  }
  return sql;
}

function requireUser(user: AuthUser | undefined): AuthUser {
  if (user === undefined) {
    throw new AppError('UNAUTHENTICATED');
  }
  return user;
}

const jobIdParams = z.object({ id: z.uuid() });

export async function registerAiJobRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const secured = [app.requireAuth];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/ai/jobs/:id',
    {
      preHandler: secured,
      schema: {
        tags: ['ai'],
        summary: 'Статус операции (отложенный запрос)',
        description:
          'Чистое чтение: ничего не запускает и не меняет, поэтому опрашивать можно ' +
          'сколько угодно. При `wait_ms > 0` сервер ждёт завершения работы и отвечает ' +
          'сразу, как только она дошла до конечного состояния. Результат в любом случае ' +
          'сохраняется в базе — вернувшийся позже клиент его дождётся.',
        security,
        params: jobIdParams,
        querystring: jobStatusQuerySchema,
        response: {
          200: jobStatusResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getJobStatus(requireSql(app), requireUser(request.authUser), request.params.id, {
        waitMs: request.query.wait_ms,
        hub: app.jobNotifyHub ?? null,
      }),
  );

  typed.post(
    '/v1/ai/jobs/:id/cancel',
    {
      preHandler: secured,
      schema: {
        tags: ['ai'],
        summary: 'Отменить операцию',
        description:
          'Отменяется только работа, которую воркер ещё не взял. Уже выполняющаяся ' +
          'операция доводится до конца: её результат применяется ровно один раз, ' +
          'и прерывать применение опаснее, чем дать ему завершиться.',
        security,
        params: jobIdParams,
        response: {
          200: jobCancelResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      cancelJob(requireSql(app), requireUser(request.authUser), request.params.id),
  );
}
