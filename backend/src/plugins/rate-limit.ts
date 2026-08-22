import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env.js';

export interface RateLimitOptions {
  readonly env: Env;
}

function rateLimitKey(request: FastifyRequest): string {
  const userId = request.authUser?.id;
  return userId === undefined ? `ip:${request.ip}` : `user:${userId}`;
}

async function rateLimitPlugin(app: FastifyInstance, options: RateLimitOptions): Promise<void> {
  const { env } = options;

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: rateLimitKey,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    allowList: (request) => request.url === '/v1/health',
  });
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  fastify: '5.x',
});
