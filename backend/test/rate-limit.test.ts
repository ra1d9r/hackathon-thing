import Fastify, { type FastifyInstance, type preHandlerAsyncHookHandler } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import rateLimitPlugin, { perUser } from '../src/plugins/rate-limit.js';
import type { AuthUser } from '../src/types/fastify.js';
import { testEnv } from './helpers/app.js';

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });

  await instance.register(rateLimitPlugin, { env: testEnv() });

  const authenticate: preHandlerAsyncHookHandler = async (request) => {
    const header = request.headers['x-test-user'];
    if (typeof header === 'string') {
      const user: AuthUser = { id: header, role: 'student', publicId: header };
      request.authUser = user;
    }
  };

  instance.get(
    '/onrequest',
    { preHandler: authenticate, config: { rateLimit: { max: 1, timeWindow: '1 minute' } } },
    async () => ({ ok: true }),
  );

  instance.get(
    '/peruser',
    { preHandler: authenticate, config: { rateLimit: perUser(1, '1 minute') } },
    async () => ({ ok: true }),
  );

  await instance.ready();
  return instance;
}

async function call(instance: FastifyInstance, url: string, user: string): Promise<number> {
  const response = await instance.inject({ method: 'GET', url, headers: { 'x-test-user': user } });
  return response.statusCode;
}

describe('пер-пользовательский лимит запросов', () => {
  it('обычное объявление считает по адресу — второй ученик получает отказ', async () => {
    app = await buildApp();

    expect(await call(app, '/onrequest', 'user-a')).toBe(200);

    expect(await call(app, '/onrequest', 'user-b')).toBe(429);
  });

  it('объявление через perUser считает по ученику', async () => {
    app = await buildApp();

    expect(await call(app, '/peruser', 'user-a')).toBe(200);
    expect(await call(app, '/peruser', 'user-b')).toBe(200);

    expect(await call(app, '/peruser', 'user-a')).toBe(429);
  });

  it('объявляет проверку на preHandler, то есть после разбора токена', () => {
    expect(perUser(10, '1 hour')).toEqual({ max: 10, timeWindow: '1 hour', hook: 'preHandler' });
  });
});
