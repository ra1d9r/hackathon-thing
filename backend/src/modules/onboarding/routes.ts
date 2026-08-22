import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  completeOnboardingResponseSchema,
  completeOnboardingSchema,
  updateLearningProfileSchema,
} from '../../contracts/dto/onboarding.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import type { AuthUser } from '../../types/fastify.js';
import { completeOnboarding, updateLearningProfile, type OnboardingResult } from './service.js';

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

function toResponse(result: OnboardingResult): {
  onboarding_completed: boolean;
  goal: OnboardingResult['goal'];
  exam_code: string | null;
  subjects: OnboardingResult['subjects'];
  diagnostic: OnboardingResult['diagnostic'];
  diagnostic_unavailable_reason: OnboardingResult['diagnosticUnavailableReason'];
} {
  return {
    onboarding_completed: true,
    goal: result.goal,
    exam_code: result.examCode,
    subjects: result.subjects,
    diagnostic: result.diagnostic,
    diagnostic_unavailable_reason: result.diagnosticUnavailableReason,
  };
}

export async function registerOnboardingRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const studentOnly = { preHandler: [app.requireRole('student')], security: [{ bearerAuth: [] }] };

  typed.post(
    '/v1/onboarding/complete',
    {
      preHandler: studentOnly.preHandler,
      schema: {
        tags: ['onboarding'],
        summary: 'Завершение первичного опроса',
        description:
          'Сохраняет цель, класс и предметы, после чего собирает диагностический тест ' +
          'из банка по выбранным предметам с учётом класса. Повторный вызов отклоняется: ' +
          'менять цель и предметы нужно через PATCH /v1/me/learning-profile.',
        security: studentOnly.security,
        body: completeOnboardingSchema,
        response: {
          200: completeOnboardingResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const result = await completeOnboarding(
        requireSql(app),
        requireStudent(request.authUser),
        request.body,
        request.id,
      );
      return toResponse(result);
    },
  );

  typed.patch(
    '/v1/me/learning-profile',
    {
      preHandler: studentOnly.preHandler,
      schema: {
        tags: ['onboarding'],
        summary: 'Изменение цели и набора предметов',
        description:
          'Диагностику не пересобирает: её результат — точка отсчёта. Убранный предмет ' +
          'помечается неактивным, накопленный по нему прогресс сохраняется.',
        security: studentOnly.security,
        body: updateLearningProfileSchema,
        response: {
          200: completeOnboardingResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const result = await updateLearningProfile(
        requireSql(app),
        requireStudent(request.authUser),
        request.body,
        request.id,
      );
      return toResponse(result);
    },
  );
}
