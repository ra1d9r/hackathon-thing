import { z } from 'zod';

import { MARKDOWN_LIMITS } from '../markdown.js';
import { materialSchema } from './materials.js';

export const createDistributionSchema = z
  .object({
    material_id: z.uuid(),
    
    class_id: z.uuid().optional(),
    student_id: z.uuid().optional(),
    message_md: z.string().max(MARKDOWN_LIMITS.note).optional(),
    due_at: z.iso.datetime().optional(),
  })
  .strict()
  .refine((value) => (value.class_id === undefined) !== (value.student_id === undefined), {
    message: 'укажите либо класс, либо ученика',
  });

export const distributionSchema = z.object({
  id: z.uuid(),
  material: z.object({
    id: z.uuid(),
    title: z.string(),
    format: materialSchema.shape.format,
  }),
  class_id: z.uuid().nullable(),
  class_name: z.string().nullable(),
  student_id: z.uuid().nullable(),
  message_md: z.string().nullable(),
  due_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  
  seen_count: z.number().int(),
  recipient_count: z.number().int(),
});

export const distributionListResponseSchema = z.object({
  distributions: z.array(distributionSchema),
  empty_reason: z.enum(['no_distributions']).nullable(),
});

export const distributionResponseSchema = z.object({ distribution: distributionSchema });

export const inboxItemSchema = z.object({
  distribution_id: z.uuid(),
  material: materialSchema,
  teacher: z.object({ id: z.uuid(), display_name: z.string() }),
  class_id: z.uuid().nullable(),
  class_name: z.string().nullable(),
  message_md: z.string().nullable(),
  due_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  seen_at: z.iso.datetime().nullable(),
  opened_at: z.iso.datetime().nullable(),
});

export const inboxResponseSchema = z.object({
  items: z.array(inboxItemSchema),
  unread: z.number().int(),
  empty_reason: z.enum(['no_items']).nullable(),
});

export const inboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  
  unread_only: z.coerce.boolean().optional(),
});

export const seenResponseSchema = z.object({
  distribution_id: z.uuid(),
  seen_at: z.iso.datetime(),
  opened_at: z.iso.datetime().nullable(),
  unread: z.number().int(),
});

export const distributionQuerySchema = z.object({
  class_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type CreateDistributionRequest = z.infer<typeof createDistributionSchema>;
export type DistributionView = z.infer<typeof distributionSchema>;
export type InboxItemView = z.infer<typeof inboxItemSchema>;
export type InboxResponse = z.infer<typeof inboxResponseSchema>;
export type InboxQuery = z.infer<typeof inboxQuerySchema>;
export type SeenResponse = z.infer<typeof seenResponseSchema>;
export type DistributionQuery = z.infer<typeof distributionQuerySchema>;
export type DistributionListResponse = z.infer<typeof distributionListResponseSchema>;
export type DistributionResponse = z.infer<typeof distributionResponseSchema>;
