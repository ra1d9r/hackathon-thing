import { z } from 'zod';

import { MAX_ROADMAP_NODES, MIN_ROADMAP_NODES } from '../domain.js';
import { aiEnvelope } from './envelope.js';

export const lessonOutlineStepSchema = z
  .object({
    step: z.number().int().min(1).max(10),
    kind: z.enum(['intro', 'theory', 'practice', 'summary']),
    title: z.string().min(1).max(120),
  })
  .strict();

export const roadmapPlanSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            position: z.number().int().min(1).max(MAX_ROADMAP_NODES),
            topic_id: z.uuid(),
            
            material_id: z.uuid().nullable(),
            title: z.string().min(1).max(140),
            outline: z.array(lessonOutlineStepSchema).min(1).max(10),
            rationale: z.string().max(300),
          })
          .strict(),
      )
      .min(MIN_ROADMAP_NODES)
      .max(MAX_ROADMAP_NODES),
    replan_reason: z.string().max(300),
  })
  .strict();

export const roadmapPlanEnvelopeSchema = aiEnvelope(roadmapPlanSchema);

export type RoadmapPlanProposal = z.infer<typeof roadmapPlanSchema>;
export type LessonOutlineStep = z.infer<typeof lessonOutlineStepSchema>;
