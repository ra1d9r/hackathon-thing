import { z } from 'zod';

import { scaleKindSchema } from '../domain.js';
import { aiEnvelope } from './envelope.js';

export const predictedScoreSchema = z
  .object({
    scale: scaleKindSchema,
    value: z.number().min(0),
    confidence: z.number().min(0).max(1),
    
    breakdown: z
      .array(
        z
          .object({
            subject_id: z.uuid(),
            expected_points: z.number().min(0),
            max_points: z.number().min(0),
            note: z.string().max(200),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    rationale: z.string().max(600),
  })
  .strict();

export const predictedScoreEnvelopeSchema = aiEnvelope(predictedScoreSchema);

export type PredictedScoreProposal = z.infer<typeof predictedScoreSchema>;
