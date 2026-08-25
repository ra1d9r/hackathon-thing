import { z } from 'zod';

import { AI_JOB_STATUSES, AI_OP_TYPES } from '../../queue/jobs.js';

export const MAX_WAIT_MS = 25_000;

export const jobStatusQuerySchema = z.object({
  wait_ms: z.coerce.number().int().min(0).max(MAX_WAIT_MS).default(0),
});

export const jobStatusResponseSchema = z.object({
  job: z.object({
    id: z.uuid(),
    op_type: z.enum(AI_OP_TYPES),
    status: z.enum(AI_JOB_STATUSES),
    attempts: z.number().int(),
    created_at: z.iso.datetime(),
    started_at: z.iso.datetime().nullable(),
    finished_at: z.iso.datetime().nullable(),
    
    applied: z.boolean(),
    error_code: z.string().nullable(),
  }),
  
  result_ref: z
    .object({ kind: z.string(), attempt_id: z.uuid().nullable() })
    .nullable(),
  
  fallback_applied: z.boolean(),
  
  retry_after_ms: z.number().int().nullable(),
});

export const jobCancelResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(AI_JOB_STATUSES),
});

export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;
