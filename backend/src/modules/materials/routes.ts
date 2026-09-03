import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  createMaterialSchema,
  fileUrlResponseSchema,
  materialListResponseSchema,
  materialQuerySchema,
  materialResponseSchema,
  patchMaterialSchema,
  uploadUrlResponseSchema,
  uploadUrlSchema,
} from '../../contracts/dto/materials.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { SupabaseAdmin } from '../../auth/supabase-admin.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  createMaterial,
  deleteMaterial,
  getFileUrl,
  getMaterial,
  listMaterials,
  patchMaterial,
  prepareUpload,
} from './service.js';

function requireSql(app: FastifyInstance): Sql {
  const sql = app.sql;
  if (sql === undefined) {
    throw new AppError('DB_UNAVAILABLE');
  }
  return sql;
}

function requireAdmin(app: FastifyInstance): SupabaseAdmin {
  const admin = app.supabaseAdmin;
  if (admin === undefined) {
    throw new AppError('INTERNAL_ERROR', { message: 'Хранилище файлов недоступно' });
  }
  return admin;
}

function requireUser(user: AuthUser | undefined): AuthUser {
  if (user === undefined) {
    throw new AppError('UNAUTHENTICATED');
  }
  return user;
}

const idParams = z.object({ id: z.uuid() });
const fileParams = z.object({ fileId: z.uuid() });

export async function registerMaterialRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const teacher = [app.requireRole('teacher')];
  const authed = [app.requireAuth];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/materials',
    {
      preHandler: teacher,
      schema: {
        tags: ['materials'],
        summary: 'Свои материалы',
        security,
        querystring: materialQuerySchema,
        response: {
          200: materialListResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      listMaterials(requireSql(app), requireUser(request.authUser), request.query),
  );

  typed.get(
    '/v1/materials/:id',
    {
      preHandler: teacher,
      schema: {
        tags: ['materials'],
        summary: 'Материал целиком',
        description:
          'Разметка отдаётся дважды: `body_md` — то, что хранится, `body_blocks` — ' +
          'разобранное дерево. Оба вида получаются одним проходом токенайзера ' +
          'и разойтись не могут.',
        security,
        params: idParams,
        response: {
          200: materialResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getMaterial(requireSql(app), requireUser(request.authUser), request.params.id),
  );

  typed.post(
    '/v1/materials/upload-url',
    {
      preHandler: teacher,
      config: { idempotency: 'off', rateLimit: perUser(60, '1 hour') },
      schema: {
        tags: ['materials'],
        summary: 'Подписанная ссылка на загрузку файла',
        description:
          'Проверяются расширение, соответствие MIME и предел размера для формата. ' +
          'Путь в бакете строит сервер: имени файла учителя там нет, поэтому обход ' +
          'каталогов невозможен. Ссылка живёт 5 минут; после загрузки вызывайте ' +
          '`POST /v1/materials` — там проверяется сигнатура содержимого.',
        security,
        body: uploadUrlSchema,
        response: {
          200: uploadUrlResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          413: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      prepareUpload(
        requireSql(app),
        requireAdmin(app),
        requireUser(request.authUser),
        request.body,
      ),
  );

  typed.post(
    '/v1/materials',
    {
      preHandler: teacher,
      config: { rateLimit: perUser(60, '1 hour') },
      schema: {
        tags: ['materials'],
        summary: 'Создать материал',
        description:
          'Три варианта: текст с разметкой, ссылка, загруженный файл. Носитель ровно ' +
          'один — это держит и схема запроса, и ограничение базы. Текст проходит ' +
          'санитайзер, ссылка — проверку схемы и приватных диапазонов, файл — ' +
          'проверку сигнатуры содержимого, а не только заявленного типа.',
        security,
        body: createMaterialSchema,
        response: {
          201: materialResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          413: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = await createMaterial(
        requireSql(app),
        app.supabaseAdmin ?? null,
        requireUser(request.authUser),
        request.body,
        request.id,
      );
      return reply.code(201).send(payload);
    },
  );

  typed.patch(
    '/v1/materials/:id',
    {
      preHandler: teacher,
      schema: {
        tags: ['materials'],
        summary: 'Изменить материал',
        description:
          'Правится заголовок, описание, текст и статус. Правка текста меняет ' +
          '`content_hash` — по нему клиент понимает, что офлайн-копию надо ' +
          'перечитать; правка заголовка его не трогает.',
        security,
        params: idParams,
        body: patchMaterialSchema,
        response: {
          200: materialResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      patchMaterial(
        requireSql(app),
        requireUser(request.authUser),
        request.params.id,
        request.body,
        request.id,
      ),
  );

  typed.delete(
    '/v1/materials/:id',
    {
      preHandler: teacher,
      schema: {
        tags: ['materials'],
        summary: 'Удалить материал',
        description:
          'Удаляется вместе с рассылками и отметками просмотра — у учеников ' +
          'материал пропадает из входящих. Уведомление в чате класса остаётся: ' +
          'это след события, а не копия материала.',
        security,
        params: idParams,
        response: {
          204: z.null(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await deleteMaterial(
        requireSql(app),
        requireUser(request.authUser),
        request.params.id,
        request.id,
      );
      return reply.status(204).send(null);
    },
  );

  typed.get(
    '/v1/files/:fileId/url',
    {
      preHandler: authed,
      schema: {
        tags: ['materials'],
        summary: 'Ссылка на скачивание файла',
        description:
          'Короткоживущая подписанная ссылка (10 минут) после проверки видимости: ' +
          'файл виден загрузившему и тем, кому присылали материал с ним. ' +
          'Невидимый файл неотличим от несуществующего.',
        security,
        params: fileParams,
        response: {
          200: fileUrlResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getFileUrl(
        requireSql(app),
        requireAdmin(app),
        requireUser(request.authUser),
        request.params.fileId,
      ),
  );
}
