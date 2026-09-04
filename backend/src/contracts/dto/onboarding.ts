import { z } from 'zod';

import { gradeSchema, learningGoalSchema, MAX_GRADE, MIN_GRADE, scaleKindSchema } from '../domain.js';

const subjectCode = z.string().trim().min(2).max(64);

export const examSummarySchema = z.object({
  code: z.string(),
  title: z.string(),
  scale: scaleKindSchema,
  max_score: z.number(),
  profile_slot_count: z.number().int(),
  grade_min: z.number().int().nullable(),
  grade_max: z.number().int().nullable(),
  time_limit_sec: z.number().int().nullable(),
});

export const goalsResponseSchema = z.object({
  goals: z.array(
    z.object({
      goal: learningGoalSchema,
      title: z.string(),
      description: z.string(),
      exams: z.array(examSummarySchema),
    }),
  ),
});

export const subjectOptionsQuerySchema = z.object({
  goal: learningGoalSchema,
  exam_code: z.string().trim().min(2).max(64).optional(),
});

export const subjectOptionsResponseSchema = z.object({
  goal: learningGoalSchema,
  exam: examSummarySchema.nullable(),
  mandatory: z.array(z.object({ code: z.string(), name: z.string() })),
  profile: z.array(z.object({ code: z.string(), name: z.string() })),
  profile_pairs: z.array(
    z.object({
      codes: z.tuple([z.string(), z.string()]),
      titles: z.tuple([z.string(), z.string()]),
    }),
  ),
});

export const topicsQuerySchema = z.object({
  subject_code: subjectCode,
  grade: z.coerce.number().int().min(MIN_GRADE).max(MAX_GRADE).optional(),
});

export const topicsResponseSchema = z.object({
  subject: z.object({ code: z.string(), name: z.string() }),
  topics: z.array(
    z.object({
      code: z.string(),
      title: z.string(),
      grade_min: z.number().int(),
      grade_max: z.number().int(),
      exam_weight: z.number(),
      prerequisites: z.array(z.string()),
    }),
  ),
});

export const completeOnboardingSchema = z.object({
  goal: learningGoalSchema,
  exam_code: z.string().trim().min(2).max(64).nullable().default(null),
  grade: gradeSchema,
  target_date: z.iso.date().nullable().default(null),
  subject_codes: z.array(subjectCode).max(10),
  answers: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const diagnosticSummarySchema = z.object({
  assessment_id: z.uuid(),
  question_count: z.number().int(),
  free_text_count: z.number().int(),
  time_limit_sec: z.number().int(),
  subjects: z.array(z.object({ code: z.string(), name: z.string(), question_count: z.number().int() })),
});

export const completeOnboardingResponseSchema = z.object({
  onboarding_completed: z.boolean(),
  goal: learningGoalSchema,
  exam_code: z.string().nullable(),
  subjects: z.array(z.object({ code: z.string(), name: z.string(), is_profile: z.boolean() })),
  diagnostic: diagnosticSummarySchema.nullable(),
  diagnostic_unavailable_reason: z.enum(['not_enough_questions']).nullable().default(null),
});

export const updateLearningProfileSchema = z.object({
  goal: learningGoalSchema.optional(),
  exam_code: z.string().trim().min(2).max(64).nullable().optional(),
  target_date: z.iso.date().nullable().optional(),
  subject_codes: z.array(subjectCode).max(10).optional(),
});

export type CompleteOnboardingRequest = z.infer<typeof completeOnboardingSchema>;
export type UpdateLearningProfileRequest = z.infer<typeof updateLearningProfileSchema>;
export type DiagnosticSummary = z.infer<typeof diagnosticSummarySchema>;
