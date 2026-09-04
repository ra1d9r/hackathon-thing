import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  generateOpenApiDocument,
  serializeOpenApiDocument,
} from '../src/openapi-document.js';

const COMMITTED_SPEC_PATH = fileURLToPath(new URL('../../docs/openapi.json', import.meta.url));

describe('docs/openapi.json', () => {
  it('существует в репозитории', () => {
    expect(
      existsSync(COMMITTED_SPEC_PATH),
      'файл контракта отсутствует — выполните: npm run gen:openapi',
    ).toBe(true);
  });

  it('совпадает с документом, который порождает текущий код', async () => {
    const generated = serializeOpenApiDocument(await generateOpenApiDocument());
    const committed = readFileSync(COMMITTED_SPEC_PATH, 'utf8');

    expect(
      committed,
      'контракт устарел — выполните: npm run gen:openapi',
    ).toBe(generated);
  });

  it('описывает схему аутентификации и адрес сервера', async () => {
    const document: unknown = await generateOpenApiDocument();

    expect(document).toMatchObject({
      openapi: '3.1.0',
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    });
    expect(document).toHaveProperty(['servers', 0, 'url']);
  });
});
