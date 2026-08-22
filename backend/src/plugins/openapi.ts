import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

import { isJsonObject } from '../contracts/json.js';
import type { Env } from '../env.js';
import { IDEMPOTENCY_PARAMETER } from './idempotency.js';

export interface OpenApiOptions {
  readonly env: Env;
}

export const OPENAPI_JSON_ROUTE = '/v1/openapi.json';
export const OPENAPI_UI_ROUTE = '/v1/docs';

async function openApiPlugin(app: FastifyInstance, options: OpenApiOptions): Promise<void> {
  const { env } = options;

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Tlek API',
        version: env.SERVICE_VERSION,
        description:
          'REST API приложения Tlek. Контракт генерируется из zod-схем сервера. ' +
          'Все изменяющие запросы требуют заголовок Idempotency-Key; ' +
          'ошибки приходят единым конвертом с полями code/message/retryable/request_id.',
      },
      servers: [{ url: env.API_BASE_URL }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Access-токен Supabase Auth. Роль читается сервером из базы.',
          },
        },
      },
      tags: [{ name: 'system', description: 'Служебные эндпоинты' }],
    },
    transform: jsonSchemaTransform,
    transformObject: (input) =>
      describeIdempotency(jsonSchemaTransformObject(input), app.idempotencyRoutes),
  });

  app.get(
    OPENAPI_JSON_ROUTE,
    { schema: { hide: true } },
    async () => app.swagger(),
  );

  if (env.NODE_ENV !== 'production') {
    await app.register(swaggerUi, {
      routePrefix: OPENAPI_UI_ROUTE,
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }
}

function describeIdempotency(document: object, routes: ReadonlySet<string> | undefined): object {
  if (routes === undefined || !isJsonObject(document) || !isJsonObject(document['paths'])) {
    return document;
  }

  for (const [path, operations] of Object.entries(document['paths'])) {
    if (!isJsonObject(operations)) {
      continue;
    }

    for (const [method, operation] of Object.entries(operations)) {
      if (!isJsonObject(operation) || !routes.has(`${method} ${path}`)) {
        continue;
      }

      const existing = operation['parameters'];
      operation['parameters'] = [
        ...(Array.isArray(existing) ? existing : []),
        IDEMPOTENCY_PARAMETER,
      ];
    }
  }

  return document;
}

export default fp(openApiPlugin, {
  name: 'openapi',
  fastify: '5.x',
});
