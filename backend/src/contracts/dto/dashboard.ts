import { z } from 'zod';

import { learningGoalSchema, masteryStatusSchema, scaleKindSchema } from '../domain.js';

export const predictedScoreSchema = z.object({
  scale: scaleKindSchema,
  value: z.number(),
  max: z.number(),
  five_grade: z.number().int().nullable(),
  confidence: z.number(),
  baseline_value: z.number(),
  delta_vs_previous: z.number().nullable(),
  computed_at: z.iso.datetime(),
  source: z.enum(['ai', 'baseline']),
});

export const focusTopicSchema = z.object({
  topic_id: z.uuid(),
  title: z.string(),
  subject_code: z.string(),
  subject_name: z.string(),
  mastery_pct: z.number(),
  priority: z.number(),
  status: masteryStatusSchema,
});

export const weakTopicSchema = z.object({
  topic_id: z.uuid(),
  title: z.string(),
  subject_code: z.string(),
  subject_name: z.string(),
  mastery_pct: z.number(),
  confidence: z.number(),
  priority: z.number(),
  status: masteryStatusSchema,
});

export const scorePointSchema = z.object({
  at: z.iso.datetime(),
  value: z.number(),
});

export const dailyPlanSchema = z.object({
  date: z.string(),
  completed: z.number().int(),
  total: z.number().int(),
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      meta: z.string(),
      subject_name: z.string().nullable(),
      status: z.enum(['pending', 'in_progress', 'completed', 'skipped']),
      kind: z.string(),
    }),
  ),
  empty_reason: z.enum(['not_generated_yet', 'no_topics']).nullable(),
});

export const upcomingMockSchema = z.object({
  assessment_id: z.uuid(),
  title: z.string(),
  question_count: z.number().int(),
  time_limit_sec: z.number().int().nullable(),
  attempted: z.boolean(),
});

export const dashboardResponseSchema = z.object({
  goal: z.object({
    kind: learningGoalSchema,
    title: z.string(),
    target_date: z.string().nullable(),
    days_left: z.number().int().nullable(),
  }),
  predicted_score: predictedScoreSchema.nullable(),
  today_focus: z.array(focusTopicSchema),
  daily_plan: dailyPlanSchema,
  streak: z.object({
    current: z.number().int(),
    longest: z.number().int(),
    today_completed: z.boolean(),
  }),
  analytics: z.object({
    questions_answered: z.number().int(),
    study_hours: z.number(),
    attempts_graded: z.number().int(),
    score_history: z.array(scorePointSchema),
    weak_topics: z.array(weakTopicSchema),
    critical_topic: weakTopicSchema.nullable(),
  }),
  upcoming_mocks: z.array(upcomingMockSchema),
  pending_ai: z.object({ jobs: z.number().int() }),
  computed_at: z.iso.datetime(),
});

export const statsOverviewSchema = z.object({
  questions_answered: z.number().int(),
  attempts_graded: z.number().int(),
  study_hours: z.number(),
  predicted_score: predictedScoreSchema.nullable(),
  subjects: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      mastery_pct: z.number(),
      topics_total: z.number().int(),
      topics_mastered: z.number().int(),
    }),
  ),
  class_name: z.string().nullable(),
  streak_days: z.number().int(),
  ai_usage_count: z.number().int(),
  computed_at: z.iso.datetime(),
});

export const statsTopicsQuerySchema = z.object({
  status: masteryStatusSchema.optional(),
  subject_code: z.string().trim().min(2).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const statsTopicsSchema = z.object({
  topics: z.array(weakTopicSchema),
  empty_reason: z.enum(['no_evidence_yet', 'filter_matched_nothing']).nullable(),
  computed_at: z.iso.datetime(),
});

export const scoreHistoryQuerySchema = z.object({
  range: z.enum(['30d', '90d', 'all']).default('90d'),
});

export const scoreHistorySchema = z.object({
  scale: scaleKindSchema,
  max: z.number(),
  points: z.array(scorePointSchema),
  computed_at: z.iso.datetime(),
});

export const heartbeatSchema = z.object({
  context: z.enum(['lesson', 'task', 'mock', 'diagnostic', 'assistant']),
  ref_id: z.uuid().nullable().default(null),
  seconds: z.number().int().min(1).max(1_800),
});

export const heartbeatResponseSchema = z.object({
  accepted_seconds: z.number().int(),
  study_hours_today: z.number(),
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type StatsOverview = z.infer<typeof statsOverviewSchema>;
export type StatsTopics = z.infer<typeof statsTopicsSchema>;
export type ScoreHistory = z.infer<typeof scoreHistorySchema>;
export type PredictedScoreView = z.infer<typeof predictedScoreSchema>;
