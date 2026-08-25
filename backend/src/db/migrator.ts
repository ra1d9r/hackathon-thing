import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from './sql.js';

export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../supabase/migrations/', import.meta.url),
);

export interface MigrationFile {
  readonly version: string;
  readonly path: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly checksum: string;
}

export interface MigrationOutcome {
  readonly version: string;
  readonly status: 'applied' | 'skipped' | 'resealed';
  readonly durationMs: number;
}

export class MigrationDriftError extends Error {
  constructor(version: string) {
    super(
      `Миграция ${version} уже применена, но её файл изменён. ` +
        'Изменять применённые миграции нельзя — добавьте новую.',
    );
    this.name = 'MigrationDriftError';
  }
}

function checksumOf(sql: string): string {
  
  const normalized = sql.replace(/\r\n?/gu, '\n').trimEnd();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function readSqlFiles(directory: string): MigrationFile[] {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'));

  return names.map((name) => {
    const path = join(directory, name);
    const sql = readFileSync(path, 'utf8');
    return {
      version: name.replace(/\.sql$/u, ''),
      path,
      sql,
      checksum: checksumOf(sql),
    };
  });
}

async function ensureMigrationTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    create schema if not exists app;
    create table if not exists app.schema_migrations (
      version     text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now(),
      duration_ms integer not null default 0
    );
  `);
}

async function listApplied(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql<AppliedMigration[]>`
    select version, checksum from app.schema_migrations
  `;
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

export interface RunMigrationsOptions {
  readonly directory?: string;
  
  readonly onProgress?: (outcome: MigrationOutcome) => void;
  
  readonly reseal?: boolean;
}

export async function runMigrations(
  sql: Sql,
  options: RunMigrationsOptions = {},
): Promise<MigrationOutcome[]> {
  const directory = options.directory ?? MIGRATIONS_DIR;

  await ensureMigrationTable(sql);
  const applied = await listApplied(sql);
  const files = readSqlFiles(directory);
  const outcomes: MigrationOutcome[] = [];

  for (const file of files) {
    const previousChecksum = applied.get(file.version);

    if (previousChecksum !== undefined) {
      if (previousChecksum !== file.checksum) {
        if (options.reseal !== true) {
          throw new MigrationDriftError(file.version);
        }

        
        
        
        await sql`
          update app.schema_migrations
             set checksum = ${file.checksum}
           where version = ${file.version}
        `;

        const resealed: MigrationOutcome = {
          version: file.version,
          status: 'resealed',
          durationMs: 0,
        };
        outcomes.push(resealed);
        options.onProgress?.(resealed);
        continue;
      }

      const outcome: MigrationOutcome = {
        version: file.version,
        status: 'skipped',
        durationMs: 0,
      };
      outcomes.push(outcome);
      options.onProgress?.(outcome);
      continue;
    }

    const startedAt = Date.now();

    await sql.begin(async (tx) => {
      await tx.unsafe(file.sql);
      await tx`
        insert into app.schema_migrations (version, checksum, duration_ms)
        values (${file.version}, ${file.checksum}, ${Date.now() - startedAt})
      `;
    });

    const outcome: MigrationOutcome = {
      version: file.version,
      status: 'applied',
      durationMs: Date.now() - startedAt,
    };
    outcomes.push(outcome);
    options.onProgress?.(outcome);
  }

  return outcomes;
}
