import { MigrationDriftError, runMigrations } from '../src/db/migrator.js';
import { createSqlClient, DEFAULT_WORKER_STATEMENT_TIMEOUT_MS } from '../src/db/sql.js';
import { EnvValidationError, getEnv, loadDotEnv } from '../src/env.js';

interface Options {
  readonly statusOnly: boolean;
  readonly reseal: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  return { statusOnly: argv.includes('--status'), reseal: argv.includes('--reseal') };
}

async function main(): Promise<void> {
  loadDotEnv();
  const env = getEnv();
  const options = parseArgs(process.argv.slice(2));

  
  const sql = createSqlClient(env, {
    statementTimeoutMs: DEFAULT_WORKER_STATEMENT_TIMEOUT_MS * 4,
    maxConnections: 1,
  });

  try {
    if (options.statusOnly) {
      const rows = await sql<{ version: string; applied_at: Date }[]>`
        select version, applied_at
          from app.schema_migrations
         order by version
      `;
      console.log(`Применено миграций: ${rows.length}`);
      for (const row of rows) {
        console.log(`  ${row.version}  ${row.applied_at.toISOString()}`);
      }
      return;
    }

    if (options.reseal) {
      console.log('Режим --reseal: применённым миграциям обновляются отпечатки.');
      console.log('SQL повторно не выполняется — правка обязана быть без изменения смысла.\n');
    }

    const outcomes = await runMigrations(sql, {
      reseal: options.reseal,
      onProgress: (outcome) => {
        const mark = { applied: '+', skipped: '=', resealed: '~' }[outcome.status];
        const suffix = {
          applied: ` (${outcome.durationMs} мс)`,
          skipped: ' (уже применена)',
          resealed: ' (отпечаток обновлён)',
        }[outcome.status];
        console.log(`  ${mark} ${outcome.version}${suffix}`);
      },
    });

    const applied = outcomes.filter((outcome) => outcome.status === 'applied').length;
    const resealed = outcomes.filter((outcome) => outcome.status === 'resealed').length;
    console.log(
      `\nМиграции: всего ${outcomes.length}, применено сейчас ${applied}` +
        (resealed > 0 ? `, отпечатков обновлено ${resealed}` : ''),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof MigrationDriftError || error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(78);
  }
  console.error(error);
  process.exit(1);
});
