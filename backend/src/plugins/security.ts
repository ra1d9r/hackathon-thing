import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env.js';

export interface SecurityOptions {
  readonly env: Env;
}

async function securityPlugin(app: FastifyInstance, options: SecurityOptions): Promise<void> {
  const { env } = options;

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length === 0 ? false : env.CORS_ORIGINS,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-request-id',
      'x-client-version',
      'if-none-match',
    ],
    exposedHeaders: ['x-request-id', 'retry-after', 'idempotent-replay', 'etag'],
    maxAge: 600,
  });
}

export default fp(securityPlugin, {
  name: 'security',
  fastify: '5.x',
});
