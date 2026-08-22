import { hostname } from 'node:os';

import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createAiRuntime } from '../ai/runtime.js';
import { createSqlClient, DEFAULT_WORKER_STATEMENT_TIMEOUT_MS, type Sql } from '../db/sql.js';
import type { Env } from '../env.js';
import { JobNotifyHub } from '../queue/notify.js';
import { QueueWorker } from '../queue/worker.js';

export interface QueueOptions {
  readonly env: Env;
}

async function queuePlugin(app: FastifyInstance, options: QueueOptions): Promise<void> {
  const { env } = options;
  const sql = app.sql;

  if (sql === undefined) {
    app.log.warn('очередь не запущена: нет подключения к базе');
    return;
  }

  const hub = new JobNotifyHub();
  app.decorate('jobNotifyHub', hub);

  try {
    await hub.start(sql);
  } catch (error: unknown) {
    app.log.error({ err: error }, 'слушатель уведомлений очереди не запущен');
  }

  app.addHook('onClose', async () => {
    await hub.stop();
  });

  if (!env.WORKER_ENABLED || env.NODE_ENV === 'test') {
    app.log.info('воркер очереди выключен');
    return;
  }

  const workerSql: Sql = createSqlClient(env, {
    maxConnections: 2,
    statementTimeoutMs: DEFAULT_WORKER_STATEMENT_TIMEOUT_MS,
  });

  const ai = createAiRuntime(env);
  if (ai === null) {
    app.log.warn(
      'ключ модели не задан: очередь работает на детерминированных заменителях',
    );
  }

  const worker = new QueueWorker({
    sql: workerSql,
    log: app.log.child({ component: 'queue' }),
    workerId: `${hostname()}:${process.pid}`,
    admin: app.supabaseAdmin ?? null,
    ai,
    aiRetryBudget: env.AI_RETRY_BUDGET,
    batchSize: env.WORKER_BATCH_SIZE,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    maintenanceIntervalMs: env.WORKER_MAINTENANCE_INTERVAL_MS,
  });

  worker.start();
  app.log.info({ batch: env.WORKER_BATCH_SIZE }, 'воркер очереди запущен');

  app.addHook('onClose', async () => {
    await worker.stop();
    await workerSql.end({ timeout: 5 });
  });
}

export default fp(queuePlugin, {
  name: 'queue',
  fastify: '5.x',
  dependencies: ['database'],
});
