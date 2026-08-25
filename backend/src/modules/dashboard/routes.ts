import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  dashboardResponseSchema,
  heartbeatResponseSchema,
  heartbeatSchema,
  predictedScoreSchema,
  scoreHistoryQuerySchema,
  scoreHistorySchema,
  statsOverviewSchema,
  statsTopicsQuerySchema,
  statsTopicsSchema,
} from '../../contracts/dto/dashboard.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  buildOverview,
  buildScoreHistory,
  buildTopics,
  getPredictedScore,
  recordHeartbeat,
} from '../stats/service.js';
import { buildDashboard } from './service.js';

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

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const onboarded = [app.requireOnboarding];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/dashboard',
    {
      preHandler: onboarded,
      schema: {
        tags: ['dashboard'],
        summary: 'Экран панели одним запросом',
        description:
          'Цель и дни до неё, ориентировочный балл, фокус дня, дневной план, серия, ' +
          'аналитика и ближайшие пробники. Всё в готовом к показу виде: проценты ' +
          'округлены, прогресс — парой completed/total. Ответ снабжён ETag: повторный ' +
          'запрос с If-None-Match вернёт 304 без тела.',
        security,
        response: {
          200: dashboardResponseSchema,
          304: z.void(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await buildDashboard(requireSql(app), requireStudent(request.authUser));
      return reply.sendCached(payload);
    },
  );

  typed.get(
    '/v1/stats/overview',
    {
      preHandler: onboarded,
      schema: {
        tags: ['dashboard'],
        summary: 'Сводка для экрана статистики',
        description:
          'Отвеченные вопросы, время за обучением, прогноз балла, мастерство ' +
          'по предметам, класс и серия дней.',
        security,
        response: {
          200: statsOverviewSchema,
          304: z.void(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await buildOverview(requireSql(app), requireStudent(request.authUser));
      return reply.sendCached(payload);
    },
  );

  typed.get(
    '/v1/stats/topics',
    {
      preHandler: onboarded,
      schema: {
        tags: ['dashboard'],
        summary: 'Темы с процентами и приоритетом',
        description:
          'Пустота выражается перечислимой причиной: свидетельств ещё нет вовсе ' +
          'либо фильтр ничего не нашёл — это разные экраны у клиента.',
        security,
        querystring: statsTopicsQuerySchema,
        response: {
          200: statsTopicsSchema,
          304: z.void(),
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await buildTopics(requireSql(app), requireStudent(request.authUser), {
        status: request.query.status,
        subjectCode: request.query.subject_code,
        limit: request.query.limit,
      });
      return reply.sendCached(payload);
    },
  );

  typed.get(
    '/v1/stats/score-history',
    {
      preHandler: onboarded,
      schema: {
        tags: ['dashboard'],
        summary: 'Точки графика прогрессии балла',
        security,
        querystring: scoreHistoryQuerySchema,
        response: {
          200: scoreHistorySchema,
          304: z.void(),
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await buildScoreHistory(
        requireSql(app),
        requireStudent(request.authUser),
        request.query.range,
      );
      return reply.sendCached(payload);
    },
  );

  typed.get(
    '/v1/predicted-score',
    {
      preHandler: onboarded,
      schema: {
        tags: ['dashboard'],
        summary: 'Ориентировочный балл',
        description:
          'Если записи ещё нет, значение считается по чертежу экзамена и сохраняется: ' +
          'ученик не должен видеть пустоту там, где данные для расчёта уже есть. ' +
          'Поле `baseline_value` показывает расчёт до вмешательства модели.',
        security,
        response: {
          200: predictedScoreSchema.nullable(),
          304: z.void(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await getPredictedScore(requireSql(app), requireStudent(request.authUser));
      return reply.sendCached(payload);
    },
  );

  typed.post(
    '/v1/study-sessions/heartbeat',
    {
      preHandler: [app.requireRole('student')],
      config: {
        
        
        idempotency: 'off',
        rateLimit: perUser(120, '1 hour'),
      },
      schema: {
        tags: ['dashboard'],
        summary: 'Накопление времени за обучением',
        description:
          'Клиент присылает секунды, прошедшие с прошлого сигнала. Сервер складывает ' +
          'их, но не больше 12 часов в сутки: время, которое приложение просто ' +
          'провисело открытым, обучением не является.',
        security,
        body: heartbeatSchema,
        response: {
          200: heartbeatResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      recordHeartbeat(requireSql(app), requireStudent(request.authUser), {
        context: request.body.context,
        refId: request.body.ref_id,
        seconds: request.body.seconds,
      }),
  );
}
