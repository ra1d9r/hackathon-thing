import { z } from 'zod';

export const dailyItemKindSchema = z.enum(['task', 'lesson', 'review']);
export const dailyItemStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'skipped']);

export const dailyItemSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  kind: dailyItemKindSchema,
  title: z.string(),
  
  meta: z.string(),
  topic: z.object({ id: z.uuid(), title: z.string() }),
  subject_name: z.string().nullable(),
  est_minutes: z.number().int().nullable(),
  status: dailyItemStatusSchema,
  
  lesson_id: z.uuid().nullable(),
  
  assessment_id: z.uuid().nullable(),
  attempt_id: z.uuid().nullable(),
  completed_at: z.iso.datetime().nullable(),
});

export const dailyPlanResponseSchema = z.object({
  plan: z
    .object({
      id: z.uuid(),
      date: z.string(),
      timezone: z.string(),
      completed: z.number().int(),
      total: z.number().int(),
      
      source: z.enum(['ai', 'fallback']),
      generated_at: z.iso.datetime(),
    })
    .nullable(),
  items: z.array(dailyItemSchema),
  streak: z.object({
    current: z.number().int(),
    longest: z.number().int(),
    today_completed: z.boolean(),
  }),
  
  empty_reason: z.enum(['no_topics', 'onboarding_incomplete']).nullable(),
});

export const dailyPlanQuerySchema = z.object({
  
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'дата в виде ГГГГ-ММ-ДД')
    .optional(),
});

export const startItemResponseSchema = z.object({
  item: dailyItemSchema,
  
  assessment_id: z.uuid().nullable(),
  attempt_id: z.uuid().nullable(),
  
  lesson_id: z.uuid().nullable(),
  
  job: z
    .object({
      job_id: z.uuid(),
      status: z.string(),
      poll_url: z.string(),
      suggested_wait_ms: z.number().int(),
    })
    .nullable(),
});

export const skipItemResponseSchema = z.object({
  item: dailyItemSchema,
  completed: z.number().int(),
  total: z.number().int(),
});

export const streakResponseSchema = z.object({
  current: z.number().int(),
  longest: z.number().int(),
  today_completed: z.boolean(),
  
  date: z.string(),
  last_completed_date: z.string().nullable(),
});

export const generateTaskSchema = z.object({
  topic_id: z.uuid(),
  
  question_count: z.number().int().min(3).max(20).optional(),
});

export const generateTaskResponseSchema = z.object({
  job_id: z.uuid(),
  status: z.string(),
  poll_url: z.string(),
  suggested_wait_ms: z.number().int(),
  
  created: z.boolean(),
});

export type DailyPlanQuery = z.infer<typeof dailyPlanQuerySchema>;
export type DailyItemView = z.infer<typeof dailyItemSchema>;
export type GenerateTaskRequest = z.infer<typeof generateTaskSchema>;
