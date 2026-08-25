import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  chatChannelListResponseSchema,
  chatMessagesQuerySchema,
  chatMessagesResponseSchema,
  chatReadResponseSchema,
  postChatMessageResponseSchema,
  postChatMessageSchema,
} from '../../contracts/dto/chat.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import { getMessages, listChannels, markRead, postMessage } from './service.js';

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

const idParams = z.object({ id: z.uuid() });

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const authed = [app.requireAuth];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/channels',
    {
      preHandler: authed,
      schema: {
        tags: ['chat'],
        summary: 'Доступные каналы',
        description:
          'Каналы, в которых пользователь состоит участником, — чаты классов ' +
          'и собственный канал ассистента. Порядок по свежести последнего ' +
          'сообщения. Непрочитанное считает сервер.',
        security,
        response: {
          200: chatChannelListResponseSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request) => listChannels(requireSql(app), requireUser(request.authUser)),
  );

  typed.get(
    '/v1/channels/:id/messages',
    {
      preHandler: authed,
      schema: {
        tags: ['chat'],
        summary: 'История канала',
        description:
          'Страница от свежих к старым по курсору `before`; сообщения отдаются ' +
          'в порядке показа. Канал, в котором вы не состоите, неотличим ' +
          'от несуществующего.',
        security,
        params: idParams,
        querystring: chatMessagesQuerySchema,
        response: {
          200: chatMessagesResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getMessages(
        requireSql(app),
        requireUser(request.authUser),
        request.params.id,
        request.query,
      ),
  );

  typed.post(
    '/v1/channels/:id/messages',
    {
      preHandler: authed,
      config: { idempotency: 'off', rateLimit: perUser(20, '1 minute') },
      schema: {
        tags: ['chat'],
        summary: 'Отправить сообщение в чат класса',
        description:
          '`client_msg_id` обязателен: повтор при обрыве связи в чате виден всему ' +
          'классу, и дубль там заметнее, чем в переписке с ассистентом. ' +
          'Сообщение, отклонённое модерацией, в канал не попадает вовсе — ' +
          'отказ возвращается отправителю и не остаётся в переписке. ' +
          'В канал ассистента этим путём не пишут.',
        security,
        params: idParams,
        body: postChatMessageSchema,
        response: {
          201: postChatMessageResponseSchema,
          200: postChatMessageResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await postMessage(
        requireSql(app),
        requireUser(request.authUser),
        request.params.id,
        request.body,
      );
      return reply.code(payload.created ? 201 : 200).send(payload);
    },
  );

  typed.post(
    '/v1/channels/:id/read',
    {
      preHandler: authed,
      config: { idempotency: 'off', rateLimit: perUser(120, '1 hour') },
      schema: {
        tags: ['chat'],
        summary: 'Отметить канал прочитанным',
        security,
        params: idParams,
        response: {
          200: chatReadResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      markRead(requireSql(app), requireUser(request.authUser), request.params.id),
  );
}
