import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateOpenApiDocument,
  serializeOpenApiDocument,
} from '../src/openapi-document.js';

const OUTPUT_URL = new URL('../../docs/openapi.json', import.meta.url);

async function main(): Promise<void> {
  const document = await generateOpenApiDocument();
  const outputPath = fileURLToPath(OUTPUT_URL);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serializeOpenApiDocument(document), 'utf8');

  console.log(`OpenAPI записан: ${outputPath}`);
}

await main();
