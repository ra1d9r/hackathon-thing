import { z } from 'zod';

import { lessonOutlineStepSchema } from '../ai/roadmap.js';
import { blocksSchema } from '../markdown.js';
import { scaleKindSchema } from '../domain.js';

export const roadmapNodeStatusSchema = z.enum(['locked', 'available', 'in_progress', 'completed']);

export const roadmapNodeSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  title: z.string(),
  topic: z.object({ id: z.uuid(), title: z.string() }),
  status: roadmapNodeStatusSchema,
  progress_pct: z.number(),
  lesson_id: z.uuid().nullable(),
  outline: z.array(lessonOutlineStepSchema),
  
  outline_edited: z.boolean(),
  rationale: z.string().nullable(),
  
  topics_covered: z.array(z.object({ id: z.uuid(), title: z.string() })),
  completed_at: z.iso.datetime().nullable(),
});

export const roadmapPredictedScoreSchema = z.object({
  scale: scaleKindSchema,
  value: z.number(),
  max: z.number(),
  
  grade_5: z.number().int().nullable(),
});

export const roadmapResponseSchema = z.object({
  roadmap: z
    .object({
      id: z.uuid(),
      subject: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
      version: z.number().int(),
      generated_at: z.iso.datetime(),
      overall_progress_pct: z.number(),
      
      source: z.enum(['ai', 'fallback']),
      replan_reason: z.string().nullable(),
    })
    .nullable(),
  nodes: z.array(roadmapNodeSchema),
  predicted_score: roadmapPredictedScoreSchema.nullable(),
  
  empty_reason: z.enum(['not_generated', 'no_topics', 'subject_not_selected']).nullable(),
});

export const roadmapQuerySchema = z.object({
  subject_id: z.uuid().optional(),
});

export const roadmapRegenerateSchema = z.object({
  subject_id: z.uuid(),
  
  reason: z.string().trim().min(1).max(300).optional(),
});

export const roadmapRegenerateResponseSchema = z.object({
  job_id: z.uuid(),
  status: z.string(),
  poll_url: z.string(),
  suggested_wait_ms: z.number().int(),
  
  created: z.boolean(),
});

export const roadmapNodeResponseSchema = z.object({
  node: roadmapNodeSchema,
  roadmap: z.object({
    id: z.uuid(),
    subject: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    version: z.number().int(),
  }),
});

export const roadmapNodeOutlineSchema = z.object({
  outline: z.array(lessonOutlineStepSchema).min(1).max(10),
});

export const materialViewKindSchema = z.enum(['markdown', 'bundled', 'file', 'link']);

export const lessonMaterialSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  summary: z.string().nullable(),
  view_kind: materialViewKindSchema,
  
  content_hash: z.string(),
  body_md: z.string().nullable(),
  body_blocks: blocksSchema,
  
  bundle: z.object({ key: z.string(), hash: z.string() }).nullable(),
  external_url: z.url().nullable(),
  est_read_minutes: z.number().int().nullable(),
});

export const lessonProgressSchema = z.object({
  progress_pct: z.number(),
  material_read: z.boolean(),
  material_read_at: z.iso.datetime().nullable(),
  best_check_pct: z.number().nullable(),
  completed_at: z.iso.datetime().nullable(),
});

export const lessonResponseSchema = z.object({
  lesson: z.object({
    id: z.uuid(),
    title: z.string(),
    subject: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    topic: z.object({ id: z.uuid(), title: z.string() }),
    outline: z.array(lessonOutlineStepSchema),
  }),
  material: lessonMaterialSchema.nullable(),
  progress: lessonProgressSchema,
  
  offline: z.object({
    material_available: z.boolean(),
    knowledge_check_requires_network: z.literal(true),
  }),
});

export const materialReadResponseSchema = z.object({
  progress: lessonProgressSchema,
  node: z
    .object({ id: z.uuid(), status: roadmapNodeStatusSchema, progress_pct: z.number() })
    .nullable(),
});

export const knowledgeCheckResponseSchema = z.object({
  
  assessment: z
    .object({
      id: z.uuid(),
      title: z.string(),
      question_count: z.number().int(),
      total_points: z.number(),
      outline: z.array(lessonOutlineStepSchema),
      source: z.enum(['ai', 'bank']),
    })
    .nullable(),
  job: z
    .object({
      job_id: z.uuid(),
      status: z.string(),
      poll_url: z.string(),
      suggested_wait_ms: z.number().int(),
    })
    .nullable(),
});

export type RoadmapQuery = z.infer<typeof roadmapQuerySchema>;
export type RoadmapRegenerateRequest = z.infer<typeof roadmapRegenerateSchema>;
export type RoadmapNodeOutlineRequest = z.infer<typeof roadmapNodeOutlineSchema>;
export type RoadmapNodeView = z.infer<typeof roadmapNodeSchema>;
export type LessonView = z.infer<typeof lessonResponseSchema>;
