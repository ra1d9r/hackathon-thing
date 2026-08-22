import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createSqlClient, type Sql } from '../db/sql.js';
import type { Env } from '../env.js';

export interface DatabaseOptions {
  readonly env: Env;
}

async function databasePlugin(app: FastifyInstance, options: DatabaseOptions): Promise<void> {
  const { env } = options;

  if (env.DATABASE_URL === undefined) {
    app.log.warn('DATABASE_URL не задан: работа с базой недоступна');
    return;
  }

  const sql: Sql = createSqlClient(env);
  app.decorate('sql', sql);

  app.addHook('onClose', async () => {
    await sql.end({ timeout: 5 });
  });
}

export default fp(databasePlugin, {
  name: 'database',
  fastify: '5.x',
});
