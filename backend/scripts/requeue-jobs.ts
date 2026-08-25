import { createSqlClient, DEFAULT_WORKER_STATEMENT_TIMEOUT_MS } from '../src/db/sql.js';
import { AI_OP_TYPES, type AiOpType } from '../src/queue/jobs.js';
import { EnvValidationError, getEnv, loadDotEnv } from '../src/env.js';

interface Options {
  readonly opTypes: readonly AiOpType[];
  readonly limit: number;
  readonly dryRun: boolean;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseOptions(): Options {
  const op = readOption('op');

  if (op !== undefined && !AI_OP_TYPES.some((known) => known === op)) {
    throw new Error(`неизвестная операция «${op}». Доступны: ${AI_OP_TYPES.join(', ')}`);
  }

  const limitRaw = readOption('limit');
  const limit = limitRaw === undefined ? 500 : Number(limitRaw);

  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error('--limit должен быть целым числом от 1 до 10000');
  }

  return {
    opTypes:
      op === undefined
        ? (['free_text_grading', 'diagnostic_analysis', 'attempt_analysis'] as const)
        : AI_OP_TYPES.filter((known) => known === op),
    limit,
    dryRun: process.argv.includes('--dry'),
  };
}

async function main(): Promise<void> {
  loadDotEnv();

  const options = parseOptions();
  const env = getEnv();

  if (env.AI_API_KEY === undefined && !options.dryRun) {
    console.error(
      'AI_API_KEY не задан: работы вернутся в очередь и снова выполнятся заменителем.\n' +
        'Сначала задайте ключ, либо запустите с --dry, чтобы только посмотреть список.',
    );
    process.exitCode = 78;
    return;
  }

  const sql = createSqlClient(env, {
    statementTimeoutMs: DEFAULT_WORKER_STATEMENT_TIMEOUT_MS,
    maxConnections: 1,
  });

  try {
    
    
    const candidates = await sql<{ id: string; op_type: string; created_at: Date }[]>`
      select id, op_type::text as op_type, created_at
        from public.ai_jobs
       where status = 'succeeded'
         and result->>'source' = 'fallback'
         and op_type = any(${[...options.opTypes]}::public.ai_op_type[])
       order by created_at
       limit ${options.limit}
    `;

    if (candidates.length === 0) {
      console.log('Работ, выполненных заменителем, не найдено.');
      return;
    }

    console.log(`Найдено работ: ${candidates.length}`);
    for (const job of candidates.slice(0, 10)) {
      console.log(`  ${job.op_type}  ${job.id}  ${job.created_at.toISOString()}`);
    }
    if (candidates.length > 10) {
      console.log(`  … и ещё ${candidates.length - 10}`);
    }

    if (options.dryRun) {
      console.log('\n--dry: ничего не изменено.');
      return;
    }

    const ids = candidates.map((job) => job.id);

    const returned = await sql<{ id: string }[]>`
      update public.ai_jobs
         set status = 'queued', applied_at = null, finished_at = null,
             locked_by = null, locked_at = null, run_after = now(),
             attempts = 0, error = null
       where id = any(${ids}::uuid[])
         -- Работа с тем же ключом могла быть поставлена заново, пока мы
         -- выбирали список: занимать ключ второй раз нельзя.
         and not exists (
           select 1 from public.ai_jobs active
            where active.dedupe_key = public.ai_jobs.dedupe_key
              and active.status in ('queued','running','awaiting_retry')
         )
      returning id
    `;

    console.log(`\nВозвращено в очередь: ${returned.length}`);
    console.log('Воркер разберёт их в обычном порядке.');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(78);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
