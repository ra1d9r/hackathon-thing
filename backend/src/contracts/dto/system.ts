import { z } from 'zod';

export const componentStatusSchema = z.enum(['ok', 'degraded', 'down', 'not_configured']);
export type ComponentStatus = z.infer<typeof componentStatusSchema>;

export const overallStatusSchema = z.enum(['ok', 'degraded', 'down']);
export type OverallStatus = z.infer<typeof overallStatusSchema>;

export const healthResponseSchema = z
  .object({
    status: overallStatusSchema,
    service: z.string(),
    version: z.string(),
    environment: z.enum(['development', 'test', 'production']),
    uptime_sec: z.number().nonnegative(),
    checked_at: z.iso.datetime(),
    components: z.object({
      db: z.object({
        status: componentStatusSchema,
        latency_ms: z.number().nonnegative().nullable(),
      }),
      ai_provider: z.object({
        status: componentStatusSchema,
        circuit: z.enum(['closed', 'half_open', 'open', 'unknown']),
      }),
      queue: z.object({
        status: componentStatusSchema,
        depth: z.number().int().nonnegative().nullable(),
        oldest_job_age_sec: z.number().int().nonnegative().nullable(),
        dead_letter: z.number().int().nonnegative().nullable(),
      }),
    }),
  })
  .describe('Состояние сервиса и его зависимостей');

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const versionResponseSchema = z
  .object({
    service: z.string(),
    version: z.string(),
    api: z.literal('v1'),
    git_sha: z.string().nullable(),
    
    min_client_version: z.string(),
    openapi_url: z.string(),
  })
  .describe('Версия сборки и требования к клиенту');

export type VersionResponse = z.infer<typeof versionResponseSchema>;
