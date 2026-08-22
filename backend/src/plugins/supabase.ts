import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createSupabaseAdmin, type SupabaseAdmin } from '../auth/supabase-admin.js';
import type { Env } from '../env.js';

export interface SupabaseOptions {
  readonly env: Env;
}

async function supabasePlugin(app: FastifyInstance, options: SupabaseOptions): Promise<void> {
  const { env } = options;
  const keyPresent = env.SUPABASE_SECRET_KEY !== undefined || env.SUPABASE_SERVICE_ROLE_KEY !== undefined;

  if (env.SUPABASE_URL === undefined || !keyPresent) {
    app.log.warn('Ключи Supabase не заданы: регистрация и работа с файлами недоступны');
    return;
  }

  const admin: SupabaseAdmin = createSupabaseAdmin(env);
  app.decorate('supabaseAdmin', admin);
}

export default fp(supabasePlugin, {
  name: 'supabase',
  fastify: '5.x',
});
