import { z } from 'zod';

const code = z.string().min(2).max(64).regex(/^[a-z0-9._-]+$/);
const grade = z.number().int().min(7).max(12);

const placeholderMark = {
  placeholder: z.boolean().default(false),
  _ЗАГОТОВКА: z.string().min(10).max(1000).optional(),
};

export const subjectsFileSchema = z.object({
  subjects: z
    .array(
      z.object({
        code,
        name_ru: z.string().min(1).max(120),
        name_kk: z.string().min(1).max(120),
        name_en: z.string().min(1).max(120),
        is_ent_mandatory: z.boolean().default(false),
        sort_order: z.number().int().min(0).max(1000).default(100),
        is_active: z.boolean().default(true),
      }),
    )
    .min(1),
});

export const topicsFileSchema = z.object({
  subject_code: code,
  ...placeholderMark,
  topics: z
    .array(
      z.object({
        code,
        title_ru: z.string().min(1).max(200),
        title_kk: z.string().max(200).nullable().default(null),
        grade_min: grade,
        grade_max: grade,
        exam_weight: z.number().min(0).max(5).default(1),
        sort_order: z.number().int().min(0).max(1000).default(100),
        prerequisites: z.array(code).default([]),
      }),
    )
    .min(1),
});

export const goalsFileSchema = z.object({
  goals: z
    .array(
      z.object({
        goal: z.enum(['subjects', 'ent', 'nis', 'olympiad']),
        title_ru: z.string().min(1).max(160),
        description_ru: z.string().min(1).max(400),
        sort_order: z.number().int().min(0).max(1000).default(100),
        is_active: z.boolean().default(true),
      }),
    )
    .min(1),
});

export const examsFileSchema = z.object({
  exams: z
    .array(
      z.object({
        code,
        title_ru: z.string().min(1).max(120),
        goal: z.enum(['ent', 'nis', 'olympiad']),
        scale_kind: z.enum(['points', 'ten']),
        max_score: z.number().min(1).max(1000),
        profile_slot_count: z.number().int().min(0).max(5).default(0),
        is_active: z.boolean().default(true),
        sections: z
          .array(
            z.object({
              slot_kind: z.enum(['mandatory', 'profile']),
              slot_index: z.number().int().min(1).max(10),
              subject_code: code.nullable().default(null),
              max_points: z.number().min(1).max(1000),
              question_count: z.number().int().min(1).max(200).nullable().default(null),
              guess_floor: z.number().min(0).max(0.99).default(0.2),
            }),
          )
          .default([]),
        subject_options: z
          .array(
            z.object({
              subject_code: code,
              slot_kind: z.enum(['mandatory', 'profile']),
              sort_order: z.number().int().min(0).max(1000).default(100),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});

const optionSchema = z.object({
  id: z.string().min(1).max(4),
  text_md: z.string().min(1).max(500),
});

const answerKeySchema = z.union([
  z.object({ correct: z.array(z.string().min(1).max(4)).min(1) }),
  z.object({ value: z.number(), tolerance: z.number().min(0).default(0) }),
  z.object({ expected_points: z.array(z.string().min(1).max(300)).min(1).max(8) }),
]);

const questionSchema = z
  .object({
    code,
    kind: z.enum(['mcq_single', 'mcq_multi', 'free_text', 'numeric']),
    topic_code: code,
    grade,
    difficulty: z.number().int().min(1).max(5).default(3),
    prompt_md: z.string().min(3).max(4000),
    options: z.array(optionSchema).min(2).max(8).nullable().default(null),
    answer_key: answerKeySchema,
    rubric_md: z.string().max(2000).nullable().default(null),
    explanation_md: z.string().max(2000).nullable().default(null),
    points: z.number().min(0.5).max(10).default(1),
  })
  .superRefine((question, ctx) => {
    const needsOptions = question.kind === 'mcq_single' || question.kind === 'mcq_multi';

    if (needsOptions && question.options === null) {
      ctx.addIssue({ code: 'custom', message: 'вопросу с выбором нужны варианты ответа' });
    }

    if (question.kind === 'free_text' && question.rubric_md === null) {
      ctx.addIssue({ code: 'custom', message: 'свободному ответу нужны критерии оценивания' });
    }

    if (needsOptions && question.options !== null && 'correct' in question.answer_key) {
      const ids = new Set(question.options.map((option) => option.id));
      for (const answer of question.answer_key.correct) {
        if (!ids.has(answer)) {
          ctx.addIssue({ code: 'custom', message: `эталонный ответ "${answer}" не найден среди вариантов` });
        }
      }
      if (question.kind === 'mcq_single' && question.answer_key.correct.length !== 1) {
        ctx.addIssue({ code: 'custom', message: 'у вопроса с одним ответом должен быть ровно один эталон' });
      }
    }
  });

export const diagnosticFileSchema = z.object({
  pool: z.literal('diagnostic'),
  ...placeholderMark,
  questions: z.array(questionSchema).min(1),
});

export const mockFileSchema = z.object({
  pool: z.literal('exam_mock'),
  ...placeholderMark,
  exam_code: code,
  mock: z.object({
    code,
    title: z.string().min(1).max(200),
    grade,
    time_limit_sec: z.number().int().min(60).max(21600),
    outline: z
      .array(
        z.object({
          step: z.number().int().min(1).max(20),
          kind: z.enum(['intro', 'theory', 'practice', 'summary', 'video', 'reading', 'quiz']),
          title: z.string().min(1).max(200),
          duration_min: z.number().int().min(1).max(240).nullable().default(null),
        }),
      )
      .default([]),
  }),
  questions: z.array(questionSchema).min(1),
});

export const lessonsFileSchema = z.object({
  ...placeholderMark,
  lessons: z
    .array(
      z.object({
        code,
        topic_code: code,
        title: z.string().min(1).max(200),
        grade_min: grade,
        grade_max: grade,
        outline: z
          .array(
            z.object({
              step: z.number().int().min(1).max(20),
              kind: z.enum(['intro', 'theory', 'practice', 'summary', 'video', 'reading', 'quiz']),
              title: z.string().min(1).max(200),
              duration_min: z.number().int().min(1).max(240).nullable().default(null),
            }),
          )
          .min(1),
        material: z.object({
          title: z.string().min(1).max(200),
          summary: z.string().max(500).nullable().default(null),
          body_md: z.string().min(1).max(20_000),
          est_read_minutes: z.number().int().min(1).max(240).default(5),
        }),
      }),
    )
    .min(1),
});

export type SubjectsFile = z.infer<typeof subjectsFileSchema>;
export type TopicsFile = z.infer<typeof topicsFileSchema>;
export type GoalsFile = z.infer<typeof goalsFileSchema>;
export type ExamsFile = z.infer<typeof examsFileSchema>;
export type DiagnosticFile = z.infer<typeof diagnosticFileSchema>;
export type MockFile = z.infer<typeof mockFileSchema>;
export type LessonsFile = z.infer<typeof lessonsFileSchema>;
export type ContentQuestion = z.infer<typeof questionSchema>;
