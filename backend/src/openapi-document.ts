import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { buildApp } from './app.js';
import { parseEnv } from './env.js';

export const OPENAPI_SPEC_SERVER_URL = 'https://api.tlek.local';

const packageJsonSchema = z.object({ version: z.string().min(1) });

function readPackageVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return packageJsonSchema.parse(parsed).version;
}

export async function generateOpenApiDocument(): Promise<object> {
  const env = parseEnv({
    NODE_ENV: 'production',
    API_BASE_URL: OPENAPI_SPEC_SERVER_URL,
    SERVICE_VERSION: readPackageVersion(),
  });

  const app = await buildApp({ env, loggerEnabled: false });
  try {
    return app.swagger();
  } finally {
    await app.close();
  }
}

export function serializeOpenApiDocument(document: object): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
