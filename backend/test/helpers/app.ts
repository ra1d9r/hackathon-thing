import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app.js';
import { parseEnv, type Env } from '../../src/env.js';

export function testEnv(overrides: NodeJS.ProcessEnv = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    API_BASE_URL: 'http://localhost:3000',
    SERVICE_VERSION: '0.0.0-test',
    ...overrides,
  });
}

export async function buildTestApp(overrides: NodeJS.ProcessEnv = {}): Promise<FastifyInstance> {
  return buildApp({ env: testEnv(overrides), loggerEnabled: false });
}
