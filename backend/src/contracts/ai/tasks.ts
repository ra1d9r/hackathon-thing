import { z } from 'zod';

import { questionKindSchema } from '../domain.js';
import { aiEnvelope } from './envelope.js';
import { lessonOutlineStepSchema } from './roadmap.js';

const answerKeySchema = z.union([
  z.object({ correct: z.array(z.string().min(1).max(4)).min(1) }).strict(),
  z.object({ value: z.number(), tolerance: z.number().min(0).default(0) }).strict(),
  z.object({ expected_points: z.array(z.string().min(1).max(200)).min(1).max(6) }).strict(),
]);

export const generatedQuestionSchema = z
  .object({
    kind: questionKindSchema,
    topic_id: z.uuid(),
    difficulty: z.number().int().min(1).max(5),
    prompt_md: z.string().min(10).max(2000),
    options: z
      .array(z.object({ id: z.string().min(1).max(4), text_md: z.string().min(1).max(500) }).strict())
      .min(2)
      .max(8)
      .nullable(),
    answer_key: answerKeySchema,
    rubric_md: z.string().max(1500).nullable(),
    explanation_md: z.string().max(1500),
    points: z.number().min(0.5).max(10),
  })
  .strict()
  .superRefine((question, ctx) => {
    const needsOptions = question.kind === 'mcq_single' || question.kind === 'mcq_multi';

    if (needsOptions && question.options === null) {
      ctx.addIssue({ code: 'custom', message: 'вопросу с выбором нужны варианты ответа' });
      return;
    }
    if (!needsOptions && question.options !== null) {
      ctx.addIssue({ code: 'custom', message: 'варианты ответа бывают только у вопроса с выбором' });
    }
    if (question.kind === 'free_text' && question.rubric_md === null) {
      ctx.addIssue({ code: 'custom', message: 'свободному ответу нужны критерии оценивания' });
    }

    const expectedKey = needsOptions
      ? 'correct'
      : question.kind === 'numeric'
        ? 'value'
        : 'expected_points';
    if (!(expectedKey in question.answer_key)) {
      ctx.addIssue({
        code: 'custom',
        message: `эталон вида "${question.kind}" описывается полем "${expectedKey}"`,
      });
      return;
    }

    if (question.options !== null && 'correct' in question.answer_key) {
      const ids = new Set(question.options.map((option) => option.id));
      const marked = new Set(question.answer_key.correct);

      for (const answer of marked) {
        if (!ids.has(answer)) {
          ctx.addIssue({ code: 'custom', message: `эталонный ответ "${answer}" не найден среди вариантов` });
        }
      }
      if (question.kind === 'mcq_single' && question.answer_key.correct.length !== 1) {
        ctx.addIssue({ code: 'custom', message: 'у вопроса с одним ответом должен быть ровно один эталон' });
      }
      if (question.kind === 'mcq_multi' && marked.size < 2) {
        ctx.addIssue({
          code: 'custom',
          message: 'у вопроса с несколькими ответами должно быть не меньше двух эталонов',
        });
      }
      if (marked.size === ids.size) {
        ctx.addIssue({ code: 'custom', message: 'верными не могут быть все варианты сразу' });
      }
    }
  });

export const generatedTaskSetSchema = z
  .object({
    title: z.string().min(1).max(120),
    est_minutes: z.number().int().min(5).max(120),
    outline: z.array(lessonOutlineStepSchema).min(1).max(10),
    questions: z.array(generatedQuestionSchema).min(3).max(20),
  })
  .strict();

export const generatedTaskSetEnvelopeSchema = aiEnvelope(generatedTaskSetSchema);

export type GeneratedTaskSet = z.infer<typeof generatedTaskSetSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
