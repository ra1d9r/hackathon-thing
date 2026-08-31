import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

const optionalSecret = z
  .string()
  .trim()
  .default('')
  .transform((value) => (value === '' ? undefined : value));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: nonEmpty.default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  API_BASE_URL: z.url().default('http://localhost:3000'),
  SERVICE_VERSION: nonEmpty.default('0.1.0'),
  GIT_SHA: optionalSecret,
  MIN_CLIENT_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'ожидается формат MAJOR.MINOR.PATCH')
    .default('1.0.0'),

  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    ),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(52_428_800)
    .default(1_048_576),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(300_000),

  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(3_600_000),

  SUPABASE_URL: optionalSecret,
  DATABASE_URL: optionalSecret,

  DATABASE_URL_DIRECT: optionalSecret,

  SUPABASE_PUBLISHABLE_KEY: optionalSecret,
  SUPABASE_SECRET_KEY: optionalSecret,

  SUPABASE_ANON_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,

  AI_API_KEY: optionalSecret,
  AI_BASE_URL: z.url().default('https://api.deepseek.com'),
  AI_MODEL: nonEmpty.default('deepseek-v4-pro'),

  AI_MODEL_OVERRIDES: z
    .string()
    .default('')
    .transform((value) =>
      Object.fromEntries(
        value
          .split(',')
          .map((pair) => pair.trim())
          .filter((pair) => pair.includes('='))
          .map((pair) => {
            const index = pair.indexOf('=');
            return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()] as const;
          }),
      ),
    ),

  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  AI_RESPONSE_FORMAT: z.enum(['json_object', 'json_schema', 'none']).default('json_object'),

  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(65_536).default(32_768),

  AI_RETRY_BUDGET: z.coerce.number().int().min(0).max(10).default(2),

  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  AI_RPM: z.coerce.number().int().min(1).max(10_000).default(60),
  AI_DAILY_QUOTA_PER_STUDENT: z.coerce.number().int().min(1).max(100_000).default(300),

  AI_BREAKER_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
  AI_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),

  TEACHER_ORG_DOMAINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain !== ''),
    ),

  WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),

  WORKER_MAINTENANCE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Некорректная конфигурация окружения:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.');
      return `${path === '' ? '(корень)' : path}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }

  return Object.freeze(result.data);
}

export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) {
    loadEnvFile(path);
  }
}

let cached: Env | null = null;

export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export type RequiredEnvKey = {
  [K in keyof Env]: Env[K] extends string | undefined ? K : never;
}[keyof Env];

export function requireEnv(env: Env, key: RequiredEnvKey, feature: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new EnvValidationError([
      `${key}: обязательна для работы «${feature}», но не задана`,
    ]);
  }
  return value;
}

export type SupabaseKeySource = 'new' | 'legacy';

export function resolveSupabaseSecretKey(env: Env): { key: string; source: SupabaseKeySource } {
  const secret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

  if (secret === undefined) {
    throw new EnvValidationError([
      'SUPABASE_SECRET_KEY (или устаревший SUPABASE_SERVICE_ROLE_KEY): обязателен для доступа к Supabase',
    ]);
  }

  return { key: secret, source: env.SUPABASE_SECRET_KEY === undefined ? 'legacy' : 'new' };
}