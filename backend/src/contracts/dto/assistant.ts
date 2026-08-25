import { z } from 'zod';

import { blocksSchema } from '../markdown.js';
import {
  moderationDecisionSchema,
  refusalReasonSchema,
  suggestedActionSchema,
} from '../ai/assistant.js';

export const senderKindSchema = z.enum(['user', 'ai', 'system']);

export const assistantMessageSchema = z.object({
  id: z.uuid(),
  sender_kind: senderKindSchema,
  body_md: z.string(),
  body_blocks: blocksSchema,
  
  moderation: moderationDecisionSchema,
  
  refusal_reason: refusalReasonSchema,
  
  referenced_topics: z.array(z.object({ id: z.uuid(), title: z.string() })),
  
  suggested_actions: z.array(suggestedActionSchema),
  
  source: z.enum(['ai', 'fallback', 'moderation']).nullable(),
  
  client_msg_id: z.string().nullable(),
  
  ai_job_id: z.uuid().nullable(),
  created_at: z.iso.datetime(),
});

export const assistantChannelResponseSchema = z.object({
  channel: z.object({
    id: z.uuid(),
    kind: z.literal('ai_assistant'),
    title: z.string(),
    created_at: z.iso.datetime(),
    
    unread: z.number().int(),
    last_read_at: z.iso.datetime().nullable(),
  }),
  
  last_message: assistantMessageSchema.nullable(),
  
  quota: z.object({
    daily_limit: z.number().int(),
    used_today: z.number().int(),
    remaining: z.number().int(),
  }),
});

export const assistantMessagesQuerySchema = z.object({
  
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const assistantMessagesResponseSchema = z.object({
  
  messages: z.array(assistantMessageSchema),
  
  next_before: z.uuid().nullable(),
  has_more: z.boolean(),
  
  empty_reason: z.enum(['no_messages']).nullable(),
});

export const postAssistantMessageSchema = z.object({
  text: z.string().min(1).max(4000),
  
  client_msg_id: z.uuid().optional(),
  
  context_hint: z
    .object({
      topic_id: z.uuid().optional(),
      lesson_id: z.uuid().optional(),
    })
    .strict()
    .optional(),
});

export const postAssistantMessageResponseSchema = z.object({
  message: assistantMessageSchema,
  
  reply: assistantMessageSchema.nullable(),
  
  job: z
    .object({
      id: z.uuid(),
      op_type: z.string(),
      status: z.string(),
      poll_url: z.string(),
      suggested_wait_ms: z.number().int(),
    })
    .nullable(),
});

export const markReadResponseSchema = z.object({
  last_read_at: z.iso.datetime(),
  unread: z.number().int(),
});

export type AssistantMessageView = z.infer<typeof assistantMessageSchema>;
export type PostAssistantMessageRequest = z.infer<typeof postAssistantMessageSchema>;
export type AssistantMessagesQuery = z.infer<typeof assistantMessagesQuerySchema>;
export type AssistantChannelResponse = z.infer<typeof assistantChannelResponseSchema>;
export type AssistantMessagesResponse = z.infer<typeof assistantMessagesResponseSchema>;
export type PostAssistantMessageResponse = z.infer<typeof postAssistantMessageResponseSchema>;
export type MarkReadResponse = z.infer<typeof markReadResponseSchema>;
