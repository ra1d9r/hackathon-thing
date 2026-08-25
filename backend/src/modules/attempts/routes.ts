import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  attemptResultSchema,
  attemptViewSchema,
  diagnosticStateSchema,
  saveAnswersResponseSchema,
  saveAnswersSchema,
  startAttemptSchema,
  submitResponseSchema,
} from '../../contracts/dto/attempts.js';
import { attemptStatusSchema } from '../../contracts/domain.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  abandonAttempt,
  getAttempt,
  getAttemptResult,
  getDiagnosticState,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from './service.js';

const RESULT_MAX_AGE_SEC = 300;

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

const attemptIdParams = z.object({ id: z.uuid() });

export async function registerAttemptRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const student = [app.requireRole('student')];
  const onboarded = [app.requireOnboarding];
  const security = [{ bearerAuth: [] }];

  typed.get(
    '/v1/diagnostic',
    {
      preHandler: onboarded,
      schema: {
        tags: ['attempts'],
        summary: 'Диагностический тест и его состояние',
        description:
          'Пустота выражается данными: если тест ещё не собран, приходит состояние ' +
          '`not_assigned` с перечислимой причиной, а не ошибка.',
        security,
        response: {
          200: diagnosticStateSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => getDiagnosticState(requireSql(app), requireStudent(request.authUser)),
  );

  typed.post(
    '/v1/attempts',
    {
      preHandler: onboarded,
      schema: {
        tags: ['attempts'],
        summary: 'Начать попытку',
        description:
          'Повторный вызов при обрыве связи возвращает ту же попытку: активная попытка ' +
          'на тест одна, а `client_attempt_id` служит вторым ключом идемпотентности.',
        security,
        body: startAttemptSchema,
        response: {
          201: attemptViewSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const view = await startAttempt(
        requireSql(app),
        requireStudent(request.authUser),
        request.body,
        request.id,
      );
      return reply.status(201).send(view);
    },
  );

  typed.get(
    '/v1/attempts/:id',
    {
      preHandler: student,
      schema: {
        tags: ['attempts'],
        summary: 'Попытка с вопросами и сохранёнными ответами',
        description:
          'Эталонные ответы, критерии оценивания и разбор в проекцию не входят: ' +
          'они появляются только в ответе на запрос результата.',
        security,
        params: attemptIdParams,
        response: {
          200: attemptViewSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      getAttempt(requireSql(app), requireStudent(request.authUser), request.params.id),
  );

  typed.patch(
    '/v1/attempts/:id/answers',
    {
      preHandler: student,
      schema: {
        tags: ['attempts'],
        summary: 'Автосохранение ответов',
        description: 'Повтор с тем же телом безопасен. После отправки попытки запрещено.',
        security,
        params: attemptIdParams,
        body: saveAnswersSchema,
        response: {
          200: saveAnswersResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      saveAnswers(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
        request.body,
      ),
  );

  typed.post(
    '/v1/attempts/:id/submit',
    {
      preHandler: student,
      schema: {
        tags: ['attempts'],
        summary: 'Отправить попытку',
        description:
          'Проверяемая часть оценивается сразу и синхронно. Свободные ответы и разбор ' +
          'уходят в очередь: ответ содержит работу, статус которой можно ждать ' +
          'отложенным запросом на GET /v1/ai/jobs/:id.',
        security,
        params: attemptIdParams,
        response: {
          202: submitResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const context = request.idempotency;

      const result = await submitAttempt(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
        {
          requestId: request.id,
          
          
          
          ...(context === undefined
            ? {}
            : {
                finalize: async (tx, status, body) => {
                  await context.complete(tx, status, body);
                },
              }),
        },
      );

      return reply.status(202).send(result);
    },
  );

  typed.get(
    '/v1/attempts/:id/result',
    {
      preHandler: student,
      schema: {
        tags: ['attempts'],
        summary: 'Результат попытки с разбором',
        description:
          'Доступен после отправки. Пока свободные ответы не оценены, они помечены ' +
          '`grader: pending`, а поле `job` указывает, чего ещё можно дождаться. ' +
          'Завершённый результат снабжён ETag: повторный запрос с If-None-Match ' +
          'вернёт 304 без тела. У незавершённого заголовков кэширования нет — ' +
          'он ещё изменится.',
        security,
        params: attemptIdParams,
        response: {
          200: attemptResultSchema,
          304: z.void(),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await getAttemptResult(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
      );

      
      
      
      
      
      
      
      
      
      
      
      
      const settled = result.attempt.status === 'graded' && result.job === null;

      if (!settled) {
        void reply.header('cache-control', 'no-store');
        return reply.send(result);
      }

      return reply.sendCached(result, { maxAgeSec: RESULT_MAX_AGE_SEC });
    },
  );

  typed.post(
    '/v1/attempts/:id/abandon',
    {
      preHandler: student,
      schema: {
        tags: ['attempts'],
        summary: 'Пометить попытку брошенной',
        security,
        params: attemptIdParams,
        response: {
          200: z.object({ id: z.uuid(), status: attemptStatusSchema }),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      abandonAttempt(
        requireSql(app),
        requireStudent(request.authUser),
        request.params.id,
        request.id,
      ),
  );
}
