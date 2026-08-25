import type { HealthResponse, OverallStatus, VersionResponse } from '../../contracts/dto/system.js';
import { pingDatabase, type Sql } from '../../db/sql.js';
import type { Env } from '../../env.js';
import { OPENAPI_JSON_ROUTE } from '../../plugins/openapi.js';

const SERVICE_NAME = 'tlek-backend';

const startedAt = Date.now();

export function uptimeSeconds(now: number = Date.now()): number {
  return Math.floor((now - startedAt) / 1000);
}

function summarize(statuses: readonly HealthResponse['components'][keyof HealthResponse['components']]['status'][]): OverallStatus {
  if (statuses.includes('down')) {
    return 'down';
  }
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  return 'ok';
}

const DB_PING_TIMEOUT_MS = 1_500;

async function checkDatabase(sql: Sql | undefined): Promise<HealthResponse['components']['db']> {
  if (sql === undefined) {
    return { status: 'not_configured', latency_ms: null };
  }

  try {
    const latency = await Promise.race([
      pingDatabase(sql),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('превышено время ожидания базы'));
        }, DB_PING_TIMEOUT_MS);
      }),
    ]);
    return { status: 'ok', latency_ms: latency };
  } catch {
    return { status: 'down', latency_ms: null };
  }
}

export async function buildHealth(
  env: Env,
  sql?: Sql,
  now: Date = new Date(),
): Promise<HealthResponse> {
  
  
  const components: HealthResponse['components'] = {
    db: await checkDatabase(sql),
    ai_provider: { status: 'not_configured', circuit: 'unknown' },
    queue: {
      status: 'not_configured',
      depth: null,
      oldest_job_age_sec: null,
      dead_letter: null,
    },
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
