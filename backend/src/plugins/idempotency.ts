import { createHash } from 'node:crypto';

import type {
  FastifyInstance,
  FastifyRequest,
  RouteOptions,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';

import { AppError } from '../contracts/errors.js';
import { jsonValueSchema, stableStringify, type JsonValue } from '../contracts/json.js';
import type { Sql, SqlExecutor } from '../db/sql.js';



const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAY_HEADER = 'idempotent-replay';

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 128;


export const IDEMPOTENCY_PARAMETER = {
  in: 'header',
  name: IDEMPOTENCY_HEADER,
  required: true,
  description:
    'Ключ идемпотентности (рекомендуется UUIDv4). Повтор запроса с тем же телом ' +
    'безопасен: сервер вернёт сохранённый ответ и заголовок Idempotent-Replay.',
  schema: { type: 'string', minLength: MIN_KEY_LENGTH, maxLength: MAX_KEY_LENGTH },
};


const PARALLEL_RETRY_AFTER_SEC = 2;

export interface IdempotencyContext {
  readonly key: string;
  readonly route: string;
  
  complete(tx: SqlExecutor, status: number, body: unknown): Promise<void>;
  readonly settled: boolean;
}

function toJsonValue(value: unknown): JsonValue {
  const parsed = jsonValueSchema.safeParse(value ?? null);
  return parsed.success ? parsed.data : null;
}

function requestHash(route: string, body: unknown, userId: string): string {
  return createHash('sha256')
    .update(`${route}\n${stableStringify(toJsonValue(body))}\n${userId}`)
    .digest('hex');
}

function readKey(request: FastifyRequest): string {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const key = Array.isArray(raw) ? raw[0] : raw;

  if (key === undefined || key.trim() === '') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Изменяющий запрос требует заголовок Idempotency-Key',
      details: { header: 'Idempotency-Key' },
    });
  }

  const trimmed = key.trim();

  if (trimmed.length < MIN_KEY_LENGTH || trimmed.length > MAX_KEY_LENGTH) {
    throw new AppError('VALIDATION_FAILED', {
      message: `Idempotency-Key должен быть длиной от ${MIN_KEY_LENGTH} до ${MAX_KEY_LENGTH} символов`,
    });
  }

  return trimmed;
}

interface StoredKeyRow {
  status: 'in_progress' | 'completed';
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

class MutableContext implements IdempotencyContext {
  settled = false;

  constructor(
    readonly key: string,
    readonly route: string,
    private readonly userId: string,
  ) {}

  async complete(tx: SqlExecutor, status: number, body: unknown): Promise<void> {
    if (this.settled) {
      return;
    }
    this.settled = true;

    await tx`
      update public.idempotency_keys
         set status = 'completed', response_status = ${status},
             response_body = ${tx.json(toJsonValue(body))}
       where user_id = ${this.userId} and route = ${this.route} and key = ${this.key}
    `;
  }

  async release(sql: Sql): Promise<void> {
    if (this.settled) {
      return;
    }
    this.settled = true;

    
    
    await sql`
      delete from public.idempotency_keys
       where user_id = ${this.userId} and route = ${this.route} and key = ${this.key}
         and status = 'in_progress'
    `;
  }
}


function toSpecPath(url: string): string {
  return url.replace(/:([^/]+)/gu, '{$1}');
}

async function idempotencyPlugin(app: FastifyInstance): Promise<void> {
  const protectedRoutes = new Set<string>();
  app.decorate('idempotencyRoutes', protectedRoutes);

  const hook: preHandlerAsyncHookHandler = async (request, reply) => {
    const user = request.authUser;

    
    
    
    if (user === undefined) {
      return;
    }

    const sql = app.sql;
    if (sql === undefined) {
      throw new AppError('DB_UNAVAILABLE');
    }

    const route = request.routeOptions.url ?? request.url;
    const key = readKey(request);
    const hash = requestHash(route, request.body, user.id);

    const inserted = await sql<{ id: string }[]>`
      insert into public.idempotency_keys (user_id, route, key, request_hash)
      values (${user.id}, ${route}, ${key}, ${hash})
      on conflict (user_id, route, key) do nothing
      returning id
    `;

    if (inserted.length > 0) {
      request.idempotency = new MutableContext(key, route, user.id);
      return;
    }

    const [stored] = await sql<StoredKeyRow[]>`
      select status, request_hash, response_status, response_body
        from public.idempotency_keys
       where user_id = ${user.id} and route = ${route} and key = ${key}
    `;

    if (stored === undefined) {
      
      
      throw new AppError('STATE_CONFLICT', { message: 'Повторите запрос' });
    }

    if (stored.request_hash !== hash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', {
        details: { route },
      });
    }

    if (stored.status === 'in_progress') {
      
      
      void reply.header('retry-after', String(PARALLEL_RETRY_AFTER_SEC));
      throw new AppError('STATE_CONFLICT', {
        message: 'Такой же запрос сейчас выполняется, повторите через пару секунд',
      });
    }

    await reply
      .status(stored.response_status ?? 200)
      .header(REPLAY_HEADER, 'true')
      .send(stored.response_body);
  };

  
  app.addHook('onRoute', (routeOptions: RouteOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];

    if (!methods.some((method) => MUTATING_METHODS.has(method))) {
      return;
    }
    if (routeOptions.config?.idempotency === 'off') {
      return;
    }

    const existing = routeOptions.preHandler;
    routeOptions.preHandler =
      existing === undefined
        ? [hook]
        : Array.isArray(existing)
          ? [...existing, hook]
          : [existing, hook];

    
    
    for (const method of methods) {
      if (MUTATING_METHODS.has(method)) {
        protectedRoutes.add(`${method.toLowerCase()} ${toSpecPath(routeOptions.url)}`);
      }
    }
  });

  app.addHook('onSend', async (request, reply, payload: unknown) => {
    const context = request.idempotency;
    if (context === undefined || !(context instanceof MutableContext) || context.settled) {
      return payload;
    }

    const sql = app.sql;
    if (sql === undefined) {
      return payload;
    }

    if (reply.statusCode >= 400) {
      await context.release(sql);
      return payload;
    }

    await context.complete(sql, reply.statusCode, parsePayload(payload));
    return payload;
  });
}


function parsePayload(payload: unknown): JsonValue {
  if (typeof payload !== 'string') {
    return toJsonValue(payload);
  }

  try {
    return toJsonValue(JSON.parse(payload));
  } catch {
    return null;
  }
}

export default fp(idempotencyPlugin, {
  name: 'idempotency',
  fastify: '5.x',
  dependencies: ['database'],
});
