import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  avatarCommitSchema,
  avatarUploadRequestSchema,
  avatarUploadResponseSchema,
  avatarUrlResponseSchema,
  meResponseSchema,
  updateProfileSchema,
} from '../../contracts/dto/auth.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { perUser } from '../../plugins/rate-limit.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  AVATAR_URL_TTL_SEC,
  commitAvatar,
  getAvatarUrl,
  getMe,
  prepareAvatarUpload,
  updateProfile,
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

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const secured = { preHandler: [app.requireAuth], security: [{ bearerAuth: [] }] };

  typed.get(
    '/v1/me',
    {
      preHandler: secured.preHandler,
      schema: {
        tags: ['profile'],
        summary: 'Профиль текущего пользователя',
        security: secured.security,
        response: { 200: meResponseSchema, 401: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      getMe(requireSql(app), app.supabaseAdmin ?? null, requireUser(request.authUser)),
  );

  typed.patch(
    '/v1/me/profile',
    {
      preHandler: secured.preHandler,
      schema: {
        tags: ['profile'],
        summary: 'Изменение профиля',
        description: 'Идентификатор и роль неизменяемы — их изменение отвергает база.',
        security: secured.security,
        body: updateProfileSchema,
        response: {
          200: meResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const sql = requireSql(app);
      const user = requireUser(request.authUser);

      await updateProfile(sql, user, request.body, request.id);
      return getMe(sql, app.supabaseAdmin ?? null, user);
    },
  );

  typed.post(
    '/v1/me/avatar/upload-url',
    {
      preHandler: secured.preHandler,
      config: { rateLimit: perUser(10, '1 hour') },
      schema: {
        tags: ['profile'],
        summary: 'Ссылка для загрузки аватара',
        description: 'Поддерживаются jpeg, png и webp размером до 5 МБ.',
        security: secured.security,
        body: avatarUploadRequestSchema,
        response: {
          200: avatarUploadResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          413: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const admin = app.supabaseAdmin;
      if (admin === undefined) {
        throw new AppError('INTERNAL_ERROR', { message: 'Хранилище файлов недоступно' });
      }

      const upload = await prepareAvatarUpload(
        requireSql(app),
        admin,
        requireUser(request.authUser),
        request.body,
      );

      return {
        file_id: upload.fileId,
        upload_url: upload.uploadUrl,
        token: upload.token,
        path: upload.path,
        expires_in_sec: upload.expiresInSec,
      };
    },
  );

  typed.post(
    '/v1/me/avatar/commit',
    {
      preHandler: secured.preHandler,
      schema: {
        tags: ['profile'],
        summary: 'Подтверждение загруженного аватара',
        description: 'Сервер сверяет сигнатуру содержимого с заявленным типом и отклоняет подмену.',
        security: secured.security,
        body: avatarCommitSchema,
        response: {
          200: meResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const admin = app.supabaseAdmin;
      if (admin === undefined) {
        throw new AppError('INTERNAL_ERROR', { message: 'Хранилище файлов недоступно' });
      }

      const sql = requireSql(app);
      const user = requireUser(request.authUser);

      await commitAvatar(sql, admin, user, request.body.file_id, request.id);
      return getMe(sql, admin, user);
    },
  );

  typed.get(
    '/v1/me/avatar',
    {
      preHandler: secured.preHandler,
      schema: {
        tags: ['profile'],
        summary: 'Подписанная ссылка на аватар',
        security: secured.security,
        response: { 200: avatarUrlResponseSchema, 401: errorEnvelopeSchema },
      },
    },
    async (request) => {
      const admin = app.supabaseAdmin;
      if (admin === undefined) {
        return { url: null, expires_in_sec: AVATAR_URL_TTL_SEC };
      }

      const url = await getAvatarUrl(requireSql(app), admin, requireUser(request.authUser));
      return { url, expires_in_sec: AVATAR_URL_TTL_SEC };
    },
  );
}
