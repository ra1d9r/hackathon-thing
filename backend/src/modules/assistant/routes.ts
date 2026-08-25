import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  assistantChannelResponseSchema,
  assistantMessagesQuerySchema,
  assistantMessagesResponseSchema,
  markReadResponseSchema,
  postAssistantMessageResponseSchema,
  postAssistantMessageSchema,
} from '../../contracts/dto/assistant.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import { getChannel, getMessages, markRead, sendMessage } from './service.js';

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

export async function registerAssistantRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const onboarded = [app.requireOnboarding];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/assistant/channel',
    {
      preHandler: onboarded,
      schema: {
        tags: ['assistant'],
        summary: 'Канал ассистента',
        description:
          'Канал создаётся при первом обращении и остаётся один на ученика. ' +
          'Вместе с ним отдаётся остаток суточного лимита вопросов — чтобы клиент ' +
          'показал его заранее, а не узнал об исчерпании отказом.',
        security,
        response: {
          200: assistantChannelResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => getChannel(requireSql(app), requireStudent(request.authUser)),
  );

  typed.get(
    '/v1/assistant/messages',
    {
      preHandler: onboarded,
      schema: {
        tags: ['assistant'],
        summary: 'История переписки',
        description:
          'Страница от свежих к старым: `before` — идентификатор сообщения, за которым ' +
          'нужна следующая страница вглубь. Сами сообщения отдаются в порядке показа, ' +
          'от старых к новым.',
        security,
        querystring: assistantMessagesQuerySchema,
        response: {
          200: assistantMessagesResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getMessages(requireSql(app), requireStudent(request.authUser), request.query),
  );

  typed.post(
    '/v1/assistant/messages',
    {
      preHandler: onboarded,
      
      
      
      config: { idempotency: 'off', rateLimit: perUser(10, '1 minute') },
      schema: {
        tags: ['assistant'],
        summary: 'Задать вопрос ассистенту',
        description:
          '`202` — вопрос принят, ответ считает очередь: опрашивайте `poll_url` либо ' +
          'ждите сообщение по Realtime. `200` — ответ уже в поле `reply`: так ' +
          'возвращается отказ по запрещённой теме, он формируется сервером без ' +
          'обращения к модели. Повтор с тем же `client_msg_id` не создаёт второго ' +
          'вопроса.',
        security,
        body: postAssistantMessageSchema,
        response: {
          200: postAssistantMessageResponseSchema,
          202: postAssistantMessageResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const outcome = await sendMessage(
        requireSql(app),
        requireStudent(request.authUser),
        request.body,
      );
      return reply.code(outcome.accepted ? 202 : 200).send(outcome.payload);
    },
  );

  typed.post(
    '/v1/assistant/read',
    {
      preHandler: onboarded,
      config: { idempotency: 'off', rateLimit: perUser(60, '1 minute') },
      schema: {
        tags: ['assistant'],
        summary: 'Отметить переписку прочитанной',
        description:
          'Сбрасывает счётчик непрочитанного канала. Без него `unread` из ' +
          '`GET /v1/assistant/channel` рос бы, и обнулить его было бы нечем.',
        security,
        response: {
          200: markReadResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => markRead(requireSql(app), requireStudent(request.authUser)),
  );
}
