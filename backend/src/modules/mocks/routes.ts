import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  mockDetailResponseSchema,
  mockListResponseSchema,
  startMockResponseSchema,
} from '../../contracts/dto/mocks.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import { getMock, listMocks, startMock } from './service.js';

function requireSql(app: FastifyInstance): Sql {
  const sql = app.sql;
  if (sql === undefined) {
    throw new AppError('DB_UNAVAILABLE');
  }
  return sql;
}

function requireStudent(user: AuthUser | undefined): AuthUser {
  if (user === undefined) {
    throw new AppError('UNAUTHENTICATED');
  }
  return user;
}

const idParamSchema = z.object({ id: z.uuid() });

export async function registerMockRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const onboarded = [app.requireOnboarding];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/mock-exams',
    {
      preHandler: onboarded,
      schema: {
        tags: ['mocks'],
        summary: 'Список доступных пробников',
        description:
          'Экзамены, по которым можно пройти пробник. Экзамен ученика идёт первым. ' +
          '`ready: false` означает, что банк заданий пока не покрывает чертёж — ' +
          'подробности видны в структуре экзамена.',
        security,
        response: {
          200: mockListResponseSchema,
          304: z.void(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await listMocks(requireSql(app), requireStudent(request.authUser));
      return reply.sendCached(payload);
    },
  );

  typed.get(
    '/v1/mock-exams/:id',
    {
      preHandler: onboarded,
      schema: {
        tags: ['mocks'],
        summary: 'Структура пробника',
        description:
          'Секции чертежа с максимумом баллов и числом заданий, лимит времени, ' +
          'незавершённая попытка и история прошлых. В `available` — сколько заданий ' +
          'банк даёт под этого ученика: меньше требуемого означает недобор.',
        security,
        params: idParamSchema,
        response: {
          200: mockDetailResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getMock(requireSql(app), requireStudent(request.authUser), request.params.id),
  );

  typed.post(
    '/v1/mock-exams/:id/attempts',
    {
      preHandler: onboarded,
      config: {
        
        
        
        idempotency: 'off',
        rateLimit: perUser(10, '1 hour'),
      },
      schema: {
        tags: ['mocks'],
        summary: 'Начать пробник',
        description:
          'Собирает пробник по чертежу под профильную пару ученика и начинает попытку ' +
          'с дедлайном по времени экзамена. Незавершённая попытка возвращается как есть: ' +
          'пересобрать пробник на середине значило бы обнулить работу. В `shortfall` — ' +
          'секции, где заданий не хватило.',
        security,
        params: idParamSchema,
        response: {
          201: startMockResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await startMock(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
        request.id,
      );
      return reply.code(201).send(payload);
    },
  );
}
