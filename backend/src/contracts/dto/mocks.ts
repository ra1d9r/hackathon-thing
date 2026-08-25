import { z } from 'zod';

export const mockSectionSchema = z.object({
  slot_kind: z.enum(['mandatory', 'profile']),
  slot_index: z.number().int(),
  subject: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
  max_points: z.number(),
  
  question_count: z.number().int().nullable(),
  
  available: z.number().int(),
});

export const mockExamSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
  max_score: z.number(),
  time_limit_sec: z.number().int().nullable(),
  grade_min: z.number().int().nullable(),
  grade_max: z.number().int().nullable(),
  
  goal: z.string().nullable(),
  
  is_target: z.boolean(),
  
  ready: z.boolean(),
  question_count: z.number().int(),
});

export const mockListResponseSchema = z.object({
  exams: z.array(mockExamSchema),
  
  profile_subjects: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
});

export const mockDetailResponseSchema = z.object({
  exam: mockExamSchema,
  sections: z.array(mockSectionSchema),
  
  active_attempt_id: z.uuid().nullable(),
  
  history: z.array(
    z.object({
      attempt_id: z.uuid(),
      submitted_at: z.iso.datetime().nullable(),
      score: z.number().nullable(),
      max_score: z.number(),
    }),
  ),
});

export const mockScoreSchema = z.object({
  exam: z.object({ id: z.uuid(), code: z.string(), title: z.string() }),
  
  scaled_score: z.number(),
  max_score: z.number(),
  sections: z.array(
    z.object({
      slot_kind: z.enum(['mandatory', 'profile']),
      slot_index: z.number().int(),
      subject: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
      points_earned: z.number(),
      points_possible: z.number(),
      max_points: z.number(),
      scaled: z.number(),
      pct: z.number(),
    }),
  ),
  
  delta_vs_previous: z.number().nullable(),
});

export const startMockResponseSchema = z.object({
  attempt_id: z.uuid(),
  assessment_id: z.uuid(),
  question_count: z.number().int(),
  time_limit_sec: z.number().int().nullable(),
  deadline_at: z.iso.datetime().nullable(),
  
  shortfall: z.array(
    z.object({
      slot_kind: z.enum(['mandatory', 'profile']),
      slot_index: z.number().int(),
      subject_id: z.uuid(),
      requested: z.number().int(),
      available: z.number().int(),
    }),
  ),
});

export type MockListResponse = z.infer<typeof mockListResponseSchema>;
export type MockDetailResponse = z.infer<typeof mockDetailResponseSchema>;
export type MockScore = z.infer<typeof mockScoreSchema>;
export type StartMockResponse = z.infer<typeof startMockResponseSchema>;
