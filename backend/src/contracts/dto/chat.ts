import { z } from 'zod';

import { moderationDecisionSchema } from '../ai/assistant.js';
import { blocksSchema, MARKDOWN_LIMITS } from '../markdown.js';

export const chatChannelSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['class_chat', 'ai_assistant']),
  title: z.string(),
  class_id: z.uuid().nullable(),
  member_count: z.number().int(),
  unread: z.number().int(),
  last_read_at: z.iso.datetime().nullable(),
  last_message_at: z.iso.datetime().nullable(),
  last_message_preview: z.string().nullable(),
  created_at: z.iso.datetime(),
});

export const chatChannelListResponseSchema = z.object({
  channels: z.array(chatChannelSchema),
  empty_reason: z.enum(['no_channels']).nullable(),
});

export const chatMessageSchema = z.object({
  id: z.uuid(),
  channel_id: z.uuid(),
  sender_kind: z.enum(['user', 'ai', 'system']),
  
  sender: z
    .object({
      id: z.uuid(),
      display_name: z.string(),
      role: z.enum(['student', 'teacher']),
    })
    .nullable(),
  body_md: z.string(),
  body_blocks: blocksSchema,
  moderation: moderationDecisionSchema,
  client_msg_id: z.string().nullable(),
  created_at: z.iso.datetime(),
  edited_at: z.iso.datetime().nullable(),
});

export const chatMessagesResponseSchema = z.object({
  
  messages: z.array(chatMessageSchema),
  next_before: z.uuid().nullable(),
  has_more: z.boolean(),
  empty_reason: z.enum(['no_messages']).nullable(),
});

export const chatMessagesQuerySchema = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const postChatMessageSchema = z
  .object({
    text: z.string().min(1).max(MARKDOWN_LIMITS.message),
    
    client_msg_id: z.uuid(),
  })
  .strict();

export const postChatMessageResponseSchema = z.object({
  message: chatMessageSchema,
  
  created: z.boolean(),
});

export const chatReadResponseSchema = z.object({
  channel_id: z.uuid(),
  last_read_at: z.iso.datetime(),
  unread: z.number().int(),
});

export type ChatChannelView = z.infer<typeof chatChannelSchema>;
export type ChatMessageView = z.infer<typeof chatMessageSchema>;
export type ChatMessagesQuery = z.infer<typeof chatMessagesQuerySchema>;
export type PostChatMessageRequest = z.infer<typeof postChatMessageSchema>;
export type ChatChannelListResponse = z.infer<typeof chatChannelListResponseSchema>;
export type ChatMessagesResponse = z.infer<typeof chatMessagesResponseSchema>;
export type PostChatMessageResponse = z.infer<typeof postChatMessageResponseSchema>;
export type ChatReadResponse = z.infer<typeof chatReadResponseSchema>;
