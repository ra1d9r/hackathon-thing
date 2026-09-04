import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorEnvelopeSchema } from '../src/contracts/errors.js';
import { healthResponseSchema, versionResponseSchema } from '../src/contracts/dto/system.js';
import { buildTestApp } from './helpers/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /v1/health', () => {
  it('отвечает 200 и телом, соответствующим схеме', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    const parsed = healthResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
  });

  it('честно сообщает о неподключённых зависимостях, а не рапортует «ok»', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = healthResponseSchema.parse(response.json());

    expect(body.components.db.status).toBe('not_configured');
    expect(body.components.ai_provider.status).toBe('not_configured');
    expect(body.components.queue.status).toBe('not_configured');
    expect(body.status).toBe('ok');
  });
});

describe('GET /v1/version', () => {
  it('отдаёт версию, требования к клиенту и адрес контракта', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/version' });

    expect(response.statusCode).toBe(200);
    const body = versionResponseSchema.parse(response.json());

    expect(body.api).toBe('v1');
    expect(body.version).toBe('0.0.0-test');
    expect(body.min_client_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.openapi_url).toContain('/v1/openapi.json');
  });
});

describe('GET /v1/openapi.json', () => {
  it('отдаёт спецификацию OpenAPI 3.1 с описанными маршрутами', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/openapi.json' });

    expect(response.statusCode).toBe(200);

    const document: unknown = response.json();
    expect(document).toMatchObject({ openapi: '3.1.0' });
    expect(document).toHaveProperty(['paths', '/v1/health']);
    expect(document).toHaveProperty(['paths', '/v1/version']);
  });

  it('не описывает сам себя в спецификации', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(response.json()).not.toHaveProperty(['paths', '/v1/openapi.json']);
  });
});

describe('обработка ошибок', () => {
  it('на неизвестный маршрут отвечает конвертом с кодом NOT_FOUND', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/такого-нет' });

    expect(response.statusCode).toBe(404);

    const envelope = errorEnvelopeSchema.parse(response.json());
    expect(envelope.error.code).toBe('NOT_FOUND');
    expect(envelope.error.retryable).toBe(false);
    expect(envelope.error.request_id.length).toBeGreaterThan(0);
  });

  it('возвращает идентификатор запроса заголовком и в теле ошибки', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/нет' });

    const header = response.headers['x-request-id'];
    const envelope = errorEnvelopeSchema.parse(response.json());

    expect(header).toBe(envelope.error.request_id);
  });

  it('принимает идентификатор запроса от клиента для сквозной корреляции', async () => {
    const clientRequestId = 'client-4f7a1c02';

    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': clientRequestId },
    });

    expect(response.headers['x-request-id']).toBe(clientRequestId);
  });

  it('генерирует идентификатор, когда клиент его не прислал', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    const header = response.headers['x-request-id'];

    expect(typeof header).toBe('string');
    expect(header).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('заголовки безопасности и CORS', () => {
  it('проставляет базовые заголовки helmet', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });

  it('по умолчанию не разрешает браузерные источники', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://other.example' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('разрешает только явно перечисленные источники', async () => {
    const allowedOrigin = 'https://web.tlek.test';
    const scoped = await buildTestApp({ CORS_ORIGINS: allowedOrigin });

    try {
      const allowed = await scoped.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { origin: allowedOrigin },
      });
      const rejected = await scoped.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { origin: 'https://other.example' },
      });

      expect(allowed.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await scoped.close();
    }
  });
});

describe('интерфейс документации', () => {
  it('доступен вне production', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/docs/' });
    expect(response.statusCode).toBe(200);
  });

  it('не поднимается в production', async () => {
    const production = await buildTestApp({ NODE_ENV: 'production' });

    try {
      const response = await production.inject({ method: 'GET', url: '/v1/docs/' });
      expect(response.statusCode).toBe(404);
    } finally {
      await production.close();
    }
  });
});
