import { z } from 'zod';

import { aiEnvelope } from './envelope.js';

const topicNote = z
  .object({
    topic_id: z.uuid(),
    note: z.string().max(200),
  })
  .strict();

export const diagnosticAnalysisSchema = z
  .object({
    strengths: z.array(topicNote).max(15).default([]),
    weaknesses: z.array(topicNote).max(25).default([]),
    mastery_estimates: z
      .array(
        z
          .object({
            topic_id: z.uuid(),
            subject_id: z.uuid(),
            
            mastery_pct: z.number().min(0).max(100),
            confidence: z.number().min(0).max(1),
            evidence_weight: z.number().min(0.1).max(1),
            reason: z.string().max(300),
          })
          .strict(),
      )
      .min(1)
      .max(120),
    summary_md: z.string().max(2000),
  })
  .strict();

export const masteryUpdateSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            topic_id: z.uuid(),
            subject_id: z.uuid(),
            
            delta_pct: z.number().min(-25).max(25),
            observed_pct: z.number().min(0).max(100).nullable().default(null),
            confidence: z.number().min(0).max(1),
            evidence_weight: z.number().min(0.1).max(1),
            reason: z.string().max(300),
          })
          .strict(),
      )
      .max(60),
    summary_md: z.string().max(1500),
  })
  .strict();

export const diagnosticAnalysisEnvelopeSchema = aiEnvelope(diagnosticAnalysisSchema);
export const masteryUpdateEnvelopeSchema = aiEnvelope(masteryUpdateSchema);

export type DiagnosticAnalysis = z.infer<typeof diagnosticAnalysisSchema>;
export type MasteryUpdate = z.infer<typeof masteryUpdateSchema>;
