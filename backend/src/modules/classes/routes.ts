import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  addMemberResponseSchema,
  addMemberSchema,
  classListResponseSchema,
  classMembersResponseSchema,
  classResponseSchema,
  createClassSchema,
  patchClassSchema,
  removeMemberResponseSchema,
} from '../../contracts/dto/classes.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  addMember,
  createClass,
  getClasses,
  getMembers,
  patchClass,
  removeMember,
} from './service.js';

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
const memberParams = z.object({ id: z.uuid(), studentId: z.uuid() });

export async function registerClassRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const teacher = [app.requireRole('teacher')];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/classes',
    {
      preHandler: teacher,
      schema: {
        tags: ['classes'],
        summary: 'Свои классы',
        description:
          'Список с числом учеников и каналом чата. Оба значения считает сервер: ' +
          'иначе список классов и экран класса однажды покажут разные числа. ' +
          'Архивные идут после действующих.',
        security,
        response: {
          200: classListResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => getClasses(requireSql(app), requireUser(request.authUser)),
  );

  typed.post(
    '/v1/classes',
    {
      preHandler: teacher,
      config: { rateLimit: perUser(30, '1 hour') },
      schema: {
        tags: ['classes'],
        summary: 'Создать класс',
        description:
          'Вместе с классом заводится канал чата — отдельный от рассылки уроков, ' +
          'как требует SPEC. Учитель добавляется в него участником: без членства ' +
          'он не увидит сообщений, владение классом политику чтения не заменяет.',
        security,
        body: createClassSchema,
        response: {
          201: classResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await createClass(
        requireSql(app),
        requireUser(request.authUser),
        request.body,
        request.id,
      );
      return reply.code(201).send(payload);
    },
  );

  typed.patch(
    '/v1/classes/:id',
    {
      preHandler: teacher,
      schema: {
        tags: ['classes'],
        summary: 'Переименовать или архивировать класс',
        description: 'Чужой класс неотличим от несуществующего — `404` в обоих случаях.',
        security,
        params: idParams,
        body: patchClassSchema,
        response: {
          200: classResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      patchClass(
        requireSql(app),
        requireUser(request.authUser),
        request.params.id,
        request.body,
        request.id,
      ),
  );

  typed.get(
    '/v1/classes/:id/members',
    {
      preHandler: teacher,
      schema: {
        tags: ['classes'],
        summary: 'Состав класса',
        security,
        params: idParams,
        response: {
          200: classMembersResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getMembers(requireSql(app), requireUser(request.authUser), request.params.id),
  );

  typed.post(
    '/v1/classes/:id/members',
    {
      preHandler: teacher,
      
      config: { rateLimit: perUser(30, '1 hour') },
      schema: {
        tags: ['classes'],
        summary: 'Добавить ученика по коду',
        description:
          'Код вида `TLK-XXXXXXXX` из профиля ученика; регистр приводится. ' +
          'Неизвестный код, код учителя и удалённый профиль дают один и тот же ' +
          '`404` — иначе перебором можно было бы выяснять, кто зарегистрирован. ' +
          'Ученик попадает и в класс, и в его чат.',
        security,
        params: idParams,
        body: addMemberSchema,
        response: {
          201: addMemberResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await addMember(
        requireSql(app),
        requireUser(request.authUser),
        request.params.id,
        request.body,
        request.id,
      );
      return reply.code(201).send(payload);
    },
  );

  typed.delete(
    '/v1/classes/:id/members/:studentId',
    {
      preHandler: teacher,
      schema: {
        tags: ['classes'],
        summary: 'Исключить ученика',
        description:
          'Членство помечается исключённым, а не удаляется: история остаётся. ' +
          'Из чата класса ученик убирается — иначе продолжал бы читать переписку.',
        security,
        params: memberParams,
        response: {
          200: removeMemberResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      removeMember(
        requireSql(app),
        requireUser(request.authUser),
        request.params.id,
        request.params.studentId,
        request.id,
      ),
  );
}
