import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  createDistributionSchema,
  distributionListResponseSchema,
  distributionQuerySchema,
  distributionResponseSchema,
  inboxQuerySchema,
  inboxResponseSchema,
  seenResponseSchema,
} from '../../contracts/dto/distributions.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import { createDistribution, getInbox, listDistributions, markSeen } from './service.js';

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

const distributionParams = z.object({ distributionId: z.uuid() });

const seenBodySchema = z
  .object({
    
    opened: z.boolean().optional(),
  })
  .strict()
  .optional();

export async function registerDistributionRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const teacher = [app.requireRole('teacher')];
  const student = [app.requireRole('student')];
  const security = [{ bearerAuth: [] }];

  typed.post(
    '/v1/distributions',
    {
      preHandler: teacher,
      config: { rateLimit: perUser(60, '1 hour') },
      schema: {
        tags: ['distributions'],
        summary: 'Отправить материал классу или ученику',
        description:
          'Адресат ровно один: класс либо ученик. Отметки о просмотре заводятся ' +
          'сразу на весь состав класса — иначе «сколько человек посмотрело» ' +
          'менялось бы задним числом при изменении состава. Ученику вне своих ' +
          'классов отправить нельзя.',
        security,
        body: createDistributionSchema,
        response: {
          201: distributionResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await createDistribution(
        requireSql(app),
        requireUser(request.authUser),
        request.body,
        request.id,
      );
      return reply.code(201).send(payload);
    },
  );

  typed.get(
    '/v1/distributions',
    {
      preHandler: teacher,
      schema: {
        tags: ['distributions'],
        summary: 'История рассылок',
        description: 'С числом получателей и числом просмотревших — считает сервер.',
        security,
        querystring: distributionQuerySchema,
        response: {
          200: distributionListResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      listDistributions(requireSql(app), requireUser(request.authUser), request.query),
  );

  typed.get(
    '/v1/inbox',
    {
      preHandler: student,
      schema: {
        tags: ['distributions'],
        summary: 'Входящие от учителей',
        description:
          'Материал приходит целиком — с `body_md` и `body_blocks`, — чтобы его ' +
          'можно было положить в офлайн-кэш по `content_hash` сразу, не делая ' +
          'второго запроса.',
        security,
        querystring: inboxQuerySchema,
        response: {
          200: inboxResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => getInbox(requireSql(app), requireUser(request.authUser), request.query),
  );

  typed.post(
    '/v1/inbox/:distributionId/seen',
    {
      preHandler: student,
      config: { idempotency: 'off', rateLimit: perUser(120, '1 hour') },
      schema: {
        tags: ['distributions'],
        summary: 'Отметить материал просмотренным',
        description:
          '`seen_at` ставится один раз и не двигается: это «когда увидел впервые», ' +
          'а не «когда открывал в последний раз». Чужая рассылка неотличима ' +
          'от несуществующей.',
        security,
        params: distributionParams,
        body: seenBodySchema,
        response: {
          200: seenResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      markSeen(
        requireSql(app),
        requireUser(request.authUser),
        request.params.distributionId,
        request.body?.opened === true,
      ),
  );
}
