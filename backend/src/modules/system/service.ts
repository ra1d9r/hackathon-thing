import type { HealthResponse, OverallStatus, VersionResponse } from '../../contracts/dto/system.js';
import { pingDatabase, type Sql } from '../../db/sql.js';
import type { Env } from '../../env.js';
import { OPENAPI_JSON_ROUTE } from '../../plugins/openapi.js';

const SERVICE_NAME = 'tlek-backend';

const startedAt = Date.now();

export function uptimeSeconds(now: number = Date.now()): number {
  return Math.floor((now - startedAt) / 1000);
}

/**
 * Сводный статус: сервис «жив», пока ни один компонент не лежит.
 * `not_configured` — это не поломка, а ещё не подключённая зависимость.
 */
function summarize(statuses: readonly HealthResponse['components'][keyof HealthResponse['components']]['status'][]): OverallStatus {
  if (statuses.includes('down')) {
    return 'down';
  }
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  return 'ok';
}

/**
 * Проба базы с собственным пределом ожидания.
 *
 * Проба живости не должна висеть дольше, чем её опрашивает хостинг: лучше
 * честно сообщить `down`, чем не ответить вовсе и получить перезапуск.
 */
const DB_PING_TIMEOUT_MS = 1_500;

async function withTimeout<T>(work: PromiseLike<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('превышено время ожидания базы'));
      }, DB_PING_TIMEOUT_MS);
    }),
  ]);
}

async function checkDatabase(sql: Sql | undefined): Promise<HealthResponse['components']['db']> {
  if (sql === undefined) {
    return { status: 'not_configured', latency_ms: null };
  }

  try {
    const latency = await withTimeout(pingDatabase(sql));
    return { status: 'ok', latency_ms: latency };
  } catch {
    return { status: 'down', latency_ms: null };
  }
}

const QUEUE_STALL_SEC = 600;

const DEAD_LETTER_WINDOW = '24 hours';

function checkAiProvider(env: Env): HealthResponse['components']['ai_provider'] {
  if (!env.AI_ENABLED || env.AI_API_KEY === undefined) {
    return { status: 'not_configured', circuit: 'unknown' };
  }

  return { status: 'ok', circuit: 'unknown' };
}

async function checkQueue(
  env: Env,
  sql: Sql | undefined,
): Promise<HealthResponse['components']['queue']> {
  const empty = { depth: null, oldest_job_age_sec: null, dead_letter: null } as const;

  if (sql === undefined) {
    return { status: 'not_configured', ...empty };
  }

  try {
    const [row] = await withTimeout(sql<
      { depth: number; oldest_sec: number; dead_letter: number }[]
    >`
      select
        count(*) filter (
          where status in ('queued', 'running', 'awaiting_retry')
        )::int as depth,
        coalesce(
          max(extract(epoch from now() - created_at)) filter (
            where status in ('queued', 'awaiting_retry')
          ),
          0
        )::int as oldest_sec,
        count(*) filter (
          where status = 'dead_letter'
            and created_at > now() - ${DEAD_LETTER_WINDOW}::interval
        )::int as dead_letter
      from public.ai_jobs
    `);

    if (row === undefined) {
      return { status: 'down', ...empty };
    }

    const metrics = {
      depth: row.depth,
      oldest_job_age_sec: row.oldest_sec,
      dead_letter: row.dead_letter,
    };

    if (!env.WORKER_ENABLED) {
      return { status: 'not_configured', ...metrics };
    }

    const stalled = row.oldest_sec > QUEUE_STALL_SEC;
    return { status: stalled || row.dead_letter > 0 ? 'degraded' : 'ok', ...metrics };
  } catch {
    return { status: 'down', ...empty };
  }
}

export async function buildHealth(
  env: Env,
  sql?: Sql,
  now: Date = new Date(),
): Promise<HealthResponse> {
  const [db, queue] = await Promise.all([checkDatabase(sql), checkQueue(env, sql)]);

  const components: HealthResponse['components'] = {
    db,
    ai_provider: checkAiProvider(env),
    queue,
  };

  return {
    status: summarize([
      components.db.status,
      components.ai_provider.status,
      components.queue.status,
    ]),
    service: SERVICE_NAME,
    version: env.SERVICE_VERSION,
    environment: env.NODE_ENV,
    uptime_sec: uptimeSeconds(now.getTime()),
    checked_at: now.toISOString(),
    components,
  };
}

export function buildVersion(env: Env): VersionResponse {
  return {
    service: SERVICE_NAME,
    version: env.SERVICE_VERSION,
    api: 'v1',
    git_sha: env.GIT_SHA ?? null,
    min_client_version: env.MIN_CLIENT_VERSION,
    openapi_url: `${env.API_BASE_URL}${OPENAPI_JSON_ROUTE}`,
  };
}
