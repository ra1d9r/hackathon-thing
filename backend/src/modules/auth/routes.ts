import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  registerRequestSchema,
  registerResponseSchema,
  teacherRequestResponseSchema,
  teacherRequestSchema,
} from '../../contracts/dto/auth.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Env } from '../../env.js';
import { registerUser, submitTeacherRequest } from './service.js';

export interface AuthRoutesOptions {
  readonly env: Env;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
): Promise<void> {
  const { env } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/v1/auth/teacher-requests',
    {
      config: {
        rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW_MS },
        
        
        idempotency: 'off',
      },
      schema: {
        tags: ['auth'],
        summary: 'Заявка на учительский доступ',
        description:
          'Учителем нельзя зарегистрироваться самостоятельно. Заявка с почтой организации ' +
          'одобряется автоматически, если её домен разрешён, иначе её рассматривает оператор.',
        body: teacherRequestSchema,
        response: {
          202: teacherRequestResponseSchema,
          400: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const sql = app.sql;
      if (sql === undefined) {
        throw new AppError('DB_UNAVAILABLE');
      }

      const result = await submitTeacherRequest(sql, env, request.body, request.id);

      return reply.status(202).send({
        request_id: result.requestId,
        status: result.status,
        can_register_now: result.canRegisterNow,
      });
    },
  );

  typed.post(
    '/v1/auth/register',
    {
      config: {
        rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW_MS },
        
        
        idempotency: 'off',
      },
      schema: {
        tags: ['auth'],
        summary: 'Регистрация',
        description:
          'Роль назначает сервер. Ученик регистрируется сразу; учителю нужна одобренная заявка. ' +
          'После регистрации вход выполняется штатным Supabase Auth на стороне клиента.',
        body: registerRequestSchema,
        response: {
          201: registerResponseSchema,
          400: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const sql = app.sql;
      const admin = app.supabaseAdmin;

      if (sql === undefined) {
        throw new AppError('DB_UNAVAILABLE');
      }
      if (admin === undefined) {
        throw new AppError('INTERNAL_ERROR', { message: 'Регистрация временно недоступна' });
      }

      const result = await registerUser(sql, admin, request.body, request.id);

      return reply.status(201).send({
        user_id: result.userId,
        public_id: result.publicId,
        role: result.role,
        requires_onboarding: result.requiresOnboarding,
      });
    },
  );
}
