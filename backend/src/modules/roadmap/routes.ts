import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  knowledgeCheckResponseSchema,
  lessonLibraryResponseSchema,
  lessonResponseSchema,
  materialReadResponseSchema,
  roadmapNodeOutlineSchema,
  roadmapNodeResponseSchema,
  roadmapQuerySchema,
  roadmapRegenerateResponseSchema,
  roadmapRegenerateSchema,
  roadmapResponseSchema,
} from '../../contracts/dto/roadmap.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import { getLesson, listLessons, markMaterialRead, openKnowledgeCheck } from '../lessons/service.js';
import {
  getRoadmap,
  getRoadmapNode,
  regenerateRoadmap,
  updateNodeOutline,
} from './service.js';

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

export async function registerRoadmapRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const onboarded = [app.requireOnboarding];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/roadmap',
    {
      preHandler: onboarded,
      schema: {
        tags: ['roadmap'],
        summary: 'Дорожная карта по предмету',
        description:
          'Узлы с процентами и статусами, план каждого урока и ориентировочный балл. ' +
          'Без `subject_id` берётся первый предмет ученика. Карты может не быть — тогда ' +
          '`empty_reason` называет причину: не построена, нет тем с материалом или ' +
          'предмет не выбран. Ответ снабжён ETag.',
        security,
        querystring: roadmapQuerySchema,
        response: {
          200: roadmapResponseSchema,
          304: z.void(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await getRoadmap(
        requireSql(app),
        requireStudent(request.authUser),
        request.query.subject_id,
      );
      return reply.sendCached(payload);
    },
  );

  typed.post(
    '/v1/roadmap/regenerate',
    {
      preHandler: onboarded,
      config: {
        idempotency: 'off',
        rateLimit: perUser(12, '1 hour'),
      },
      schema: {
        tags: ['roadmap'],
        summary: 'Перепланировать карту',
        description:
          'Ставит операцию `roadmap_plan` в очередь и возвращает `job_id` для опроса. ' +
          'Не чаще одного переплана в шесть часов на предмет: повторный запрос внутри ' +
          'окна возвращает ту же работу с `created: false`, а не ошибку.',
        security,
        body: roadmapRegenerateSchema,
        response: {
          202: roadmapRegenerateResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await regenerateRoadmap(
        requireSql(app),
        requireStudent(request.authUser),
        request.body,
      );
      return reply.code(202).send(payload);
    },
  );

  typed.get(
    '/v1/roadmap/nodes/:id',
    {
      preHandler: onboarded,
      schema: {
        tags: ['roadmap'],
        summary: 'Состав урока в узле карты',
        description:
          'Шаги урока («1. Интро, 2. Тема, 3. Задание»), статус и прогресс узла. ' +
          'Чужой узел неотличим от несуществующего: оба дают 404.',
        security,
        params: idParamSchema,
        response: {
          200: roadmapNodeResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getRoadmapNode(requireSql(app), requireStudent(request.authUser), request.params.id),
  );

  typed.patch(
    '/v1/roadmap/nodes/:id/outline',
    {
      preHandler: onboarded,
      config: { rateLimit: perUser(60, '1 hour') },
      schema: {
        tags: ['roadmap'],
        summary: 'Правка плана урока',
        description:
          'Тема узла неизменна, а состав шагов правится. Черновик модели сохраняется ' +
          'отдельно, поэтому перепланирование правку не затирает (04-domain-logic.md, §6.7).',
        security,
        params: idParamSchema,
        body: roadmapNodeOutlineSchema,
        response: {
          200: roadmapNodeResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      updateNodeOutline(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
        request.body,
      ),
  );

  typed.get(
    '/v1/lessons',
    {
      preHandler: onboarded,
      schema: {
        tags: ['roadmap'],
        summary: 'Уроки ученика по предметам',
        description:
          'Библиотека вкладки «Обучение»: материал и проверка знаний, независимо ' +
          'от дневного плана и дорожной карты. Тема представлена одним уроком — тем же, ' +
          'в который ведёт дневной план.',
        security,
        response: {
          200: lessonLibraryResponseSchema,
          304: z.void(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await listLessons(requireSql(app), requireStudent(request.authUser));
      return reply.sendCached(payload);
    },
  );

  typed.get(
    '/v1/lessons/:id',
    {
      preHandler: onboarded,
      schema: {
        tags: ['roadmap'],
        summary: 'Материал урока и план',
        description:
          'Материал приходит в кэшируемом виде: разметка, разобранное дерево и ' +
          '`content_hash` как ключ инвалидации. Для актива из сборки приложения — ' +
          'ключ и контрольная сумма, байты сервер не хранит. Блок `offline` говорит, ' +
          'что доступно без сети: материал да, проверка знаний нет.',
        security,
        params: idParamSchema,
        response: {
          200: lessonResponseSchema,
          304: z.void(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await getLesson(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
      );
      return reply.sendCached(payload);
    },
  );

  typed.post(
    '/v1/lessons/:id/material-read',
    {
      preHandler: onboarded,
      config: { idempotency: 'off', rateLimit: perUser(120, '1 hour') },
      schema: {
        tags: ['roadmap'],
        summary: 'Отметить материал прочитанным',
        description:
          'Даёт 30 % прогресса урока и продвигает узел карты. Повторный вызов ничего ' +
          'не меняет: «прочитано» — событие, а не счётчик.',
        security,
        params: idParamSchema,
        response: {
          200: materialReadResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      markMaterialRead(requireSql(app), requireStudent(request.authUser), request.params.id),
  );

  typed.post(
    '/v1/lessons/:id/knowledge-check',
    {
      preHandler: onboarded,
      config: { idempotency: 'off', rateLimit: perUser(30, '1 hour') },
      schema: {
        tags: ['roadmap'],
        summary: 'Открыть проверку знаний',
        description:
          'Возвращает готовую проверку по этому уроку, если она уже есть, иначе ставит ' +
          'генерацию в очередь и отдаёт `job_id`. Повторное открытие даёт тот же тест, ' +
          'а не новый с другими вопросами.',
        security,
        params: idParamSchema,
        response: {
          200: knowledgeCheckResponseSchema,
          202: knowledgeCheckResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await openKnowledgeCheck(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
      );
      return reply.code(payload.assessment === null ? 202 : 200).send(payload);
    },
  );
}
