import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';

import type { UserRole } from '../contracts/domain.js';
import { AppError } from '../contracts/errors.js';
import { createJwtVerifier, extractBearerToken, type JwtVerifier } from '../auth/jwt.js';
import type { Sql } from '../db/sql.js';
import type { Env } from '../env.js';
import type { AuthUser } from '../types/fastify.js';

export interface AuthOptions {
  readonly env: Env;
}

const ROLE_CACHE_TTL_MS = 60_000;

const ROLE_CACHE_MAX_ENTRIES = 5_000;

interface CachedProfile {
  readonly user: AuthUser;
  readonly expiresAt: number;
}

async function loadProfile(sql: Sql, userId: string): Promise<AuthUser> {
  const [row] = await sql<{ id: string; role: UserRole; public_id: string }[]>`
    select id, role, public_id from public.profiles where id = ${userId}
  `;

  if (row === undefined) {
    throw new AppError('UNAUTHENTICATED', {
      message: 'Профиль не найден — завершите регистрацию',
    });
  }

  return { id: row.id, role: row.role, publicId: row.public_id };
}

async function authPlugin(app: FastifyInstance, options: AuthOptions): Promise<void> {
  const { env } = options;
  const cache = new Map<string, CachedProfile>();
  let verifier: JwtVerifier | null = null;

  const getVerifier = (): JwtVerifier => {
    verifier ??= createJwtVerifier(env);
    return verifier;
  };

  const authenticate = async (request: FastifyRequest): Promise<void> => {
    if (request.authUser !== undefined) {
      return;
    }

    const sql = app.sql;
    if (sql === undefined) {
      throw new AppError('DB_UNAVAILABLE');
    }

    const token = extractBearerToken(request.headers.authorization);
    const verified = await getVerifier().verify(token);

    const cached = cache.get(verified.userId);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      request.authUser = cached.user;
      return;
    }

    const user = await loadProfile(sql, verified.userId);

    if (cache.size >= ROLE_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) {
        cache.delete(oldest.value);
      }
    }

    cache.set(verified.userId, { user, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
    request.authUser = user;
  };

  const requireAuth: preHandlerAsyncHookHandler = async (request) => {
    await authenticate(request);
  };

  app.decorate('requireAuth', requireAuth);

  app.decorate('requireRole', (role: UserRole): preHandlerAsyncHookHandler => {
    return async (request) => {
      await authenticate(request);
      if (request.authUser?.role !== role) {
        throw new AppError('FORBIDDEN_ROLE');
      }
    };
  });

  const requireOnboarding: preHandlerAsyncHookHandler = async (request) => {
    await authenticate(request);

    const user = request.authUser;
    if (user?.role !== 'student') {
      throw new AppError('FORBIDDEN_ROLE');
    }

    const sql = app.sql;
    if (sql === undefined) {
      throw new AppError('DB_UNAVAILABLE');
    }

    const [row] = await sql<{ onboarding_completed_at: Date | null }[]>`
      select onboarding_completed_at
        from public.student_profiles
       where student_id = ${user.id}
    `;

    if (row?.onboarding_completed_at == null) {
      throw new AppError('ONBOARDING_INCOMPLETE');
    }
  };

  app.decorate('requireOnboarding', requireOnboarding);
}

export default fp(authPlugin, {
  name: 'auth',
  fastify: '5.x',
  dependencies: ['database'],
});
