import { z } from 'zod';

import { aiEnvelope } from './envelope.js';

export const refusalReasonSchema = z.enum([
  'off_topic',
  'unsafe',
  'out_of_grade_scope',
  'none',
]);
export type RefusalReason = z.infer<typeof refusalReasonSchema>;

export const suggestedActionKindSchema = z.enum(['open_lesson', 'start_task', 'open_roadmap']);
export type SuggestedActionKind = z.infer<typeof suggestedActionKindSchema>;

export const suggestedActionSchema = z
  .object({
    kind: suggestedActionKindSchema,
    ref_id: z.uuid(),
    label: z.string().min(1).max(60),
  })
  .strict();
export type SuggestedAction = z.infer<typeof suggestedActionSchema>;

export const assistantReplySchema = z
  .object({
    reply_md: z.string().min(1).max(4000),
    refused: z.boolean(),
    refusal_reason: refusalReasonSchema,
    referenced_topics: z.array(z.uuid()).max(5).default([]),
    suggested_actions: z.array(suggestedActionSchema).max(3).default([]),
  })
  .strict()
  .superRefine((reply, ctx) => {
    
    
    
    if (reply.refused && reply.refusal_reason === 'none') {
      ctx.addIssue({ code: 'custom', message: 'отказ обязан называть причину' });
    }
    if (!reply.refused && reply.refusal_reason !== 'none') {
      ctx.addIssue({ code: 'custom', message: 'причина отказа указана без самого отказа' });
    }
  });

export type AssistantReply = z.infer<typeof assistantReplySchema>;

export const assistantReplyEnvelopeSchema = aiEnvelope(assistantReplySchema);

export const moderationDecisionSchema = z.enum(['allow', 'block', 'redirect']);
export type ModerationDecision = z.infer<typeof moderationDecisionSchema>;

export const moderationCategorySchema = z.enum([
  'none',
  'nsfw',
  'nsfl',
  'self_harm',
  'political',
  'ideological',
  'out_of_scope',
  'prompt_injection',
  'other',
]);
export type ModerationCategory = z.infer<typeof moderationCategorySchema>;

export const moderationVerdictSchema = z
  .object({
    verdict: moderationDecisionSchema,
    category: moderationCategorySchema,
    rationale: z.string().max(300),
  })
  .strict();

export type ModerationVerdict = z.infer<typeof moderationVerdictSchema>;

export const moderationVerdictEnvelopeSchema = aiEnvelope(moderationVerdictSchema);
