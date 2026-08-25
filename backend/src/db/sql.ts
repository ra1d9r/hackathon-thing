import postgres from 'postgres';

import { requireEnv, type Env } from '../env.js';

export type Sql = postgres.Sql;

export type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface SqlClientOptions {
  
  readonly statementTimeoutMs?: number;
  readonly maxConnections?: number;
  
  readonly keepAlive?: boolean;
}

export const DEFAULT_API_STATEMENT_TIMEOUT_MS = 8_000;
export const DEFAULT_WORKER_STATEMENT_TIMEOUT_MS = 30_000;

export function createSqlClient(env: Env, options: SqlClientOptions = {}): Sql {
  const url = requireEnv(env, 'DATABASE_URL', 'доступ к базе данных');

  const statementTimeout = options.statementTimeoutMs ?? DEFAULT_API_STATEMENT_TIMEOUT_MS;

  return postgres(url, {
    max: options.maxConnections ?? 5,
    idle_timeout: options.keepAlive === true ? 0 : 20,
    connect_timeout: 10,
    ssl: 'require',
    connection: {
      statement_timeout: statementTimeout,
      application_name: 'tlek-backend',
    },
    
    onnotice: () => undefined,
  });
}

export async function pingDatabase(sql: Sql): Promise<number> {
  const startedAt = Date.now();
  await sql`select 1 as ok`;
  return Date.now() - startedAt;
}
