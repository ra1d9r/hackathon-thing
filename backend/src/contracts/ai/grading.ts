import { z } from 'zod';

import { aiEnvelope } from './envelope.js';

export const gradingResultSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            question_id: z.uuid(),
            
            score_ratio: z.number().min(0).max(1),
            is_correct: z.boolean(),
            feedback_md: z.string().min(1).max(1200),
            confidence: z.number().min(0).max(1),
            
            misconceptions: z.array(z.string().max(120)).max(3).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();

export const gradingEnvelopeSchema = aiEnvelope(gradingResultSchema);

export type GradingResult = z.infer<typeof gradingResultSchema>;
export type GradingEnvelope = z.infer<typeof gradingEnvelopeSchema>;
