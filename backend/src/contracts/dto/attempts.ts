import { z } from 'zod';

import { mockScoreSchema } from './mocks.js';

import { attemptStatusSchema, questionKindSchema } from '../domain.js';

export const FREE_TEXT_MAX_CHARS = 2000;

const MAX_SELECTED_OPTIONS = 8;

export const optionIdSchema = z.string().trim().min(1).max(4);

export const answerPayloadSchema = z
  .object({
    
    selected: z.array(optionIdSchema).max(MAX_SELECTED_OPTIONS).optional(),
    
    value: z.number().optional(),
    
    text: z.string().max(FREE_TEXT_MAX_CHARS).optional(),
  })
  .refine(
    (answer) =>
      answer.selected !== undefined || answer.value !== undefined || answer.text !== undefined,
    { message: 'ответ пуст' },
  );

export type AnswerPayload = z.infer<typeof answerPayloadSchema>;

export const startAttemptSchema = z.object({
  assessment_id: z.uuid(),
  
  client_attempt_id: z.string().trim().min(8).max(64).nullable().default(null),
});

export const questionViewSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  kind: questionKindSchema,
  prompt_md: z.string(),
  
  options: z
    .array(z.object({ id: z.string(), text_md: z.string() }))
    .nullable(),
  points: z.number(),
  difficulty: z.number().int(),
  
  max_chars: z.number().int().nullable(),
  subject: z.object({ code: z.string(), name: z.string() }),
  topic: z.object({ id: z.uuid(), title: z.string() }),
});

export const savedAnswerSchema = z.object({
  question_id: z.uuid(),
  answer: answerPayloadSchema,
  time_spent_sec: z.number().int(),
  answered_at: z.iso.datetime(),
});

export const attemptHeaderSchema = z.object({
  id: z.uuid(),
  assessment_id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  status: attemptStatusSchema,
  started_at: z.iso.datetime(),
  submitted_at: z.iso.datetime().nullable(),
  deadline_at: z.iso.datetime().nullable(),
  time_limit_sec: z.number().int().nullable(),
  time_spent_sec: z.number().int(),
  answered_count: z.number().int(),
  total_count: z.number().int(),
});

export const attemptViewSchema = z.object({
  attempt: attemptHeaderSchema,
  questions: z.array(questionViewSchema),
  answers: z.array(savedAnswerSchema),
  server_time: z.iso.datetime(),
});

export const saveAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.uuid(),
        answer: answerPayloadSchema,
        time_spent_sec: z.number().int().min(0).max(43_200).default(0),
      }),
    )
    .min(1)
    .max(50),
});

export const saveAnswersResponseSchema = z.object({
  saved: z.number().int(),
  answered_count: z.number().int(),
  total_count: z.number().int(),
  server_time: z.iso.datetime(),
});

export const jobRefSchema = z.object({
  id: z.uuid(),
  op_type: z.string(),
  status: z.string(),
  poll_url: z.string(),
  
  suggested_wait_ms: z.number().int(),
});

export const submitResponseSchema = z.object({
  attempt: z.object({
    id: z.uuid(),
    status: attemptStatusSchema,
    deterministic: z.object({
      raw_score: z.number(),
      max_score: z.number(),
      graded_questions: z.number().int(),
    }),
    
    pending_ai_questions: z.number().int(),
  }),
  
  job: jobRefSchema.nullable(),
});

export const topicResultSchema = z.object({
  topic_id: z.uuid(),
  title: z.string(),
  subject_code: z.string(),
  points_earned: z.number(),
  points_possible: z.number(),
  pct: z.number(),
  
  mastery_pct: z.number().nullable(),
  delta_pct: z.number().nullable(),
});

export const subjectResultSchema = z.object({
  code: z.string(),
  name: z.string(),
  points_earned: z.number(),
  points_possible: z.number(),
  pct: z.number(),
});

export const answerReviewSchema = z.object({
  question_id: z.uuid(),
  position: z.number().int(),
  kind: questionKindSchema,
  prompt_md: z.string(),
  options: z.array(z.object({ id: z.string(), text_md: z.string() })).nullable(),
  your_answer: answerPayloadSchema.nullable(),
  
  correct_answer: z
    .object({
      selected: z.array(z.string()).optional(),
      value: z.number().optional(),
      expected_points: z.array(z.string()).optional(),
    })
    .nullable(),
  is_correct: z.boolean().nullable(),
  points: z.number(),
  points_awarded: z.number().nullable(),
  grader: z.enum(['deterministic', 'ai', 'pending']),
  explanation_md: z.string().nullable(),
  ai_feedback_md: z.string().nullable(),
});

const highlightSchema = z.object({
  topic_id: z.uuid(),
  title: z.string(),
  pct: z.number(),
  note: z.string().nullable(),
});

export const attemptResultSchema = z.object({
  attempt: z.object({
    id: z.uuid(),
    assessment_id: z.uuid(),
    kind: z.string(),
    title: z.string(),
    status: attemptStatusSchema,
    submitted_at: z.iso.datetime().nullable(),
    graded_at: z.iso.datetime().nullable(),
    raw_score: z.number().nullable(),
    max_score: z.number().nullable(),
    score_pct: z.number().nullable(),
    time_spent_sec: z.number().int(),
    
    pending_questions: z.number().int(),
  }),
  subjects: z.array(subjectResultSchema),
  topics: z.array(topicResultSchema),
  
  strengths: z.array(highlightSchema),
  focus: z.array(highlightSchema),
  answers: z.array(answerReviewSchema),
  
  analysis: z
    .object({
      source: z.enum(['ai', 'fallback']),
      summary_md: z.string().nullable(),
      computed_at: z.iso.datetime(),
    })
    .nullable(),
  
  exam: mockScoreSchema.nullable(),
  
  job: jobRefSchema.nullable(),
});

export const diagnosticStateSchema = z.object({
  
  state: z.enum(['not_assigned', 'available', 'in_progress', 'grading', 'completed']),
  assessment: z
    .object({
      id: z.uuid(),
      title: z.string(),
      question_count: z.number().int(),
      free_text_count: z.number().int(),
      time_limit_sec: z.number().int().nullable(),
      total_points: z.number(),
      subjects: z.array(
        z.object({ code: z.string(), name: z.string(), question_count: z.number().int() }),
      ),
    })
    .nullable(),
  attempt: z
    .object({
      id: z.uuid(),
      status: attemptStatusSchema,
      started_at: z.iso.datetime(),
      submitted_at: z.iso.datetime().nullable(),
      answered_count: z.number().int(),
      total_count: z.number().int(),
    })
    .nullable(),
  empty_reason: z.enum(['onboarding_incomplete', 'not_enough_questions']).nullable(),
});

export type StartAttemptRequest = z.infer<typeof startAttemptSchema>;
export type SaveAnswersRequest = z.infer<typeof saveAnswersSchema>;
export type AttemptView = z.infer<typeof attemptViewSchema>;
export type AttemptResult = z.infer<typeof attemptResultSchema>;
export type SubmitResponse = z.infer<typeof submitResponseSchema>;
export type DiagnosticState = z.infer<typeof diagnosticStateSchema>;
export type JobRef = z.infer<typeof jobRefSchema>;
