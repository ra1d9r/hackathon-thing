import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { healthResponseSchema, versionResponseSchema } from '../../contracts/dto/system.js';
import { errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Env } from '../../env.js';
import { buildHealth, buildVersion } from './service.js';

export interface SystemRoutesOptions {
  readonly env: Env;
}

export async function registerSystemRoutes(
  app: FastifyInstance,
  options: SystemRoutesOptions,
): Promise<void> {
  const { env } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Состояние сервиса',
        description:
          'Проба живости для хостинга и быстрая диагностика зависимостей. ' +
          'Не требует аутентификации и не учитывается в лимите запросов.',
        response: {
          200: healthResponseSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async () => buildHealth(env, app.sql),
  );

  typed.get(
    '/v1/version',
    {
      schema: {
        tags: ['system'],
        summary: 'Версия сборки и требования к клиенту',
        response: {
          200: versionResponseSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async () => buildVersion(env),
  );
}
