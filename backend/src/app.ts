import { randomUUID } from 'node:crypto';

import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { getEnv, type Env } from './env.js';
import { registerAiJobRoutes } from './modules/ai-jobs/routes.js';
import { registerAssistantRoutes } from './modules/assistant/routes.js';
import { registerAttemptRoutes } from './modules/attempts/routes.js';
import { registerDailyRoutes } from './modules/daily/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerCatalogRoutes } from './modules/catalog/routes.js';
import { registerChatRoutes } from './modules/chat/routes.js';
import { registerClassRoutes } from './modules/classes/routes.js';
import { registerDistributionRoutes } from './modules/distributions/routes.js';
import { registerMaterialRoutes } from './modules/materials/routes.js';
import { registerOnboardingRoutes } from './modules/onboarding/routes.js';
import { registerMockRoutes } from './modules/mocks/routes.js';
import { registerProfileRoutes } from './modules/profile/routes.js';
import { registerRoadmapRoutes } from './modules/roadmap/routes.js';
import { registerSystemRoutes } from './modules/system/routes.js';
import auth from './plugins/auth.js';
import database from './plugins/database.js';
import errorHandler from './plugins/error-handler.js';
import etag from './plugins/etag.js';
import idempotency from './plugins/idempotency.js';
import openApi from './plugins/openapi.js';
import queue from './plugins/queue.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import requestContext from './plugins/request-context.js';
import security from './plugins/security.js';
import supabase from './plugins/supabase.js';

import './types/fastify.js';

export interface BuildAppOptions {
  readonly env?: Env;
  readonly loggerEnabled?: boolean;
}

type LoggerOption = NonNullable<FastifyServerOptions['logger']>;

function loggerOptions(env: Env, enabled: boolean): LoggerOption {
  if (!enabled) {
    return false;
  }

  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["idempotency-key"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[скрыто]',
    },
    serializers: {
      req: (request: {
        id: string;
        method: string;
        url: string;
        ip: string;
      }) => ({
        id: request.id,
        method: request.method,
        url: request.url,
        ip: request.ip,
      }),
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? getEnv();
  const loggerEnabled = options.loggerEnabled ?? env.NODE_ENV !== 'test';

  const app = Fastify({
    logger: loggerOptions(env, loggerEnabled),
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    logController: new LogController({
      requestIdLogLabel: 'request_id',
      disableRequestLogging: false,
    }),
    bodyLimit: env.BODY_LIMIT_BYTES,
    requestTimeout: env.REQUEST_TIMEOUT_MS,

    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(requestContext);
  await app.register(errorHandler);
  await app.register(database, { env });
  await app.register(supabase, { env });
  await app.register(auth, { env });
  await app.register(security, { env });
  await app.register(rateLimitPlugin, { env });
  await app.register(etag);
  await app.register(idempotency);
  await app.register(openApi, { env });
  await app.register(queue, { env });

  await app.register(async (instance) => {
    await registerSystemRoutes(instance, { env });
    await registerAuthRoutes(instance, { env });
    await registerProfileRoutes(instance);
    await registerCatalogRoutes(instance);
    await registerOnboardingRoutes(instance);
    await registerAttemptRoutes(instance);
    await registerAiJobRoutes(instance);
    await registerDashboardRoutes(instance);
    await registerRoadmapRoutes(instance);
    await registerDailyRoutes(instance);
    await registerMockRoutes(instance);
    await registerAssistantRoutes(instance);
    await registerClassRoutes(instance);
    await registerMaterialRoutes(instance);
    await registerDistributionRoutes(instance);
    await registerChatRoutes(instance);
  });

  await app.ready();
  return app;
}
