import { z } from 'zod';

import { MAX_DAILY_ITEMS } from '../domain.js';
import { aiEnvelope } from './envelope.js';

export const dailyPlanSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            position: z.number().int().min(1).max(MAX_DAILY_ITEMS),
            kind: z.enum(['task', 'lesson', 'review']),
            topic_id: z.uuid(),
            title: z.string().min(1).max(120),
            
            meta: z.string().max(60),
            est_minutes: z.number().int().min(5).max(120),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    rationale: z.string().max(300),
  })
  .strict();

export const dailyPlanEnvelopeSchema = aiEnvelope(dailyPlanSchema);

export type DailyPlanProposal = z.infer<typeof dailyPlanSchema>;
