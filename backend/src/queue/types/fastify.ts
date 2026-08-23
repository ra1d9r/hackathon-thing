import type { preHandlerAsyncHookHandler } from 'fastify';

import type { SupabaseAdmin } from '../auth/supabase-admin.js';
import type { Sql } from '../db/sql.js';
import type { UserRole } from '../contracts/domain.js';
import type { IdempotencyContext } from '../plugins/idempotency.js';
import type { JobNotifyHub } from '../queue/notify.js';

export interface AuthUser {
  readonly id: string;
  readonly role: UserRole;
  readonly publicId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
    idempotency?: IdempotencyContext;
  }

  interface FastifyContextConfig {
    idempotency?: 'off';
  }

  interface FastifyInstance {
    sql?: Sql;
    supabaseAdmin?: SupabaseAdmin;
    requireAuth: preHandlerAsyncHookHandler;
    requireRole: (role: UserRole) => preHandlerAsyncHookHandler;
    requireOnboarding: preHandlerAsyncHookHandler;
    jobNotifyHub?: JobNotifyHub;
    idempotencyRoutes?: ReadonlySet<string>;
  }
}
