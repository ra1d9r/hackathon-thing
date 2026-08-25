import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  dailyPlanQuerySchema,
  dailyPlanResponseSchema,
  generateTaskResponseSchema,
  generateTaskSchema,
  skipItemResponseSchema,
  startItemResponseSchema,
  streakResponseSchema,
} from '../../contracts/dto/daily.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import { generateTask, getDailyPlan, getStreak, skipItem, startItem } from './service.js';

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

export async function registerDailyRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const onboarded = [app.requireOnboarding];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/daily-plan',
    {
      preHandler: onboarded,
      schema: {
        tags: ['daily'],
        summary: 'План занятий на день',
        description:
          'План создаётся при первом запросе в новую локальную дату ученика и возвращается ' +
          'сразу: собирается расчётом, а уточнение моделью идёт фоном. Параллельные запросы ' +
          'с двух устройств создают ровно один план. Прошлая дата, на которую плана не было, ' +
          'возвращает пустоту — задним числом занятия не выдумываются.',
        security,
        querystring: dailyPlanQuerySchema,
        response: {
          200: dailyPlanResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getDailyPlan(requireSql(app), requireStudent(request.authUser), request.query.date),
  );

  typed.post(
    '/v1/daily-plan/items/:id/start',
    {
      preHandler: onboarded,
      config: { idempotency: 'off', rateLimit: perUser(60, '1 hour') },
      schema: {
        tags: ['daily'],
        summary: 'Начать пункт плана',
        description:
          'Урок открывается сразу. Задаче нужен набор вопросов: если его ещё нет, ' +
          'возвращается `job_id` для опроса, а повторное «начать» после готовности ' +
          'ведёт в тот же тест, а не заказывает второй.',
        security,
        params: idParamSchema,
        response: {
          200: startItemResponseSchema,
          202: startItemResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await startItem(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
        request.id,
      );
      return reply.code(payload.job === null ? 200 : 202).send(payload);
    },
  );

  typed.post(
    '/v1/daily-plan/items/:id/skip',
    {
      preHandler: onboarded,
      config: { idempotency: 'off', rateLimit: perUser(60, '1 hour') },
      schema: {
        tags: ['daily'],
        summary: 'Пропустить пункт плана',
        description:
          'Пропущенный пункт считается закрытым: план из трёх, где один пропустили, ' +
          'не висит незавершённым до полуночи. Выполненный пункт пропустить нельзя.',
        security,
        params: idParamSchema,
        response: {
          200: skipItemResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      skipItem(requireSql(app), requireStudent(request.authUser), request.params.id),
  );

  typed.get(
    '/v1/streak',
    {
      preHandler: onboarded,
      schema: {
        tags: ['daily'],
        summary: 'Серия дней',
        description:
          'Текущая и наибольшая серия. «Сегодня» считается по локальной дате ученика, ' +
          'а не по часам сервера.',
        security,
        response: {
          200: streakResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => getStreak(requireSql(app), requireStudent(request.authUser)),
  );

  typed.post(
    '/v1/tasks/generate',
    {
      preHandler: onboarded,
      config: { rateLimit: perUser(20, '1 hour') },
      schema: {
        tags: ['daily'],
        summary: 'Заказать задачу по теме',
        description:
          'Ставит `task_generation` в очередь и возвращает `job_id`. Повтор с тем же ' +
          '`Idempotency-Key` возвращает ту же работу, а не сочиняет второй набор. ' +
          'Тема вне охвата ученика неотличима от несуществующей.',
        security,
        body: generateTaskSchema,
        response: {
          202: generateTaskResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const header = request.headers['idempotency-key'];
      const payload = await generateTask(
        requireSql(app),
        requireStudent(request.authUser),
        request.body,
        typeof header === 'string' && header.trim() !== '' ? header : null,
      );
      return reply.code(202).send(payload);
    },
  );
}
