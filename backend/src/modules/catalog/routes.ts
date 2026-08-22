import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  goalsResponseSchema,
  subjectOptionsQuerySchema,
  subjectOptionsResponseSchema,
  topicsQuerySchema,
  topicsResponseSchema,
} from '../../contracts/dto/onboarding.js';
import { isExamGoal } from '../../contracts/domain.js';
import { AppError, errorEnvelopeSchema } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { findExam, listGoals, listSubjectOptions, listTopics } from './service.js';

function requireSql(app: FastifyInstance): Sql {
  const sql = app.sql;
  if (sql === undefined) {
    throw new AppError('DB_UNAVAILABLE');
  }
  return sql;
}

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const secured = { preHandler: [app.requireAuth], security: [{ bearerAuth: [] }] };

  typed.get(
    '/v1/catalog/goals',
    {
      preHandler: secured.preHandler,
      schema: {
        tags: ['catalog'],
        summary: 'Цели обучения и доступные экзамены',
        description:
          'Формулировки и состав экзаменов приходят из данных: новая олимпиада появляется ' +
          'здесь после правки supabase/content/exams.json, без изменений в коде.',
        security: secured.security,
        response: { 200: goalsResponseSchema, 401: errorEnvelopeSchema },
      },
    },
    async () => {
      const goals = await listGoals(requireSql(app));
      return {
        goals: goals.map((goal) => ({
          goal: goal.goal,
          title: goal.title,
          description: goal.description,
          exams: goal.exams.map((exam) => ({
            code: exam.code,
            title: exam.title,
            scale: exam.scale,
            max_score: exam.maxScore,
            profile_slot_count: exam.profileSlotCount,
          })),
        })),
      };
    },
  );

  typed.get(
    '/v1/catalog/subjects',
    {
      preHandler: secured.preHandler,
      schema: {
        tags: ['catalog'],
        summary: 'Предметы, доступные для выбранной цели',
        description:
          'Обязательные предметы добавляются автоматически; из профильных выбирается ' +
          'ровно profile_slot_count штук.',
        security: secured.security,
        querystring: subjectOptionsQuerySchema,
        response: {
          200: subjectOptionsResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const sql = requireSql(app);
      const { goal, exam_code: examCode } = request.query;

      if (!isExamGoal(goal)) {
        const options = await listSubjectOptions(sql, null);
        return { goal, exam: null, mandatory: options.mandatory, profile: options.profile };
      }

      if (examCode === undefined) {
        throw new AppError('VALIDATION_FAILED', {
          message: 'Для этой цели нужно указать exam_code',
          details: { goal },
        });
      }

      const exam = await findExam(sql, examCode);
      if (exam.goal !== goal) {
        throw new AppError('VALIDATION_FAILED', {
          message: 'Экзамен не относится к выбранной цели',
          details: { goal, exam_goal: exam.goal },
        });
      }

      const options = await listSubjectOptions(sql, examCode);

      return {
        goal,
        exam: {
          code: exam.code,
          title: exam.title,
          scale: exam.scale,
          max_score: exam.maxScore,
          profile_slot_count: exam.profileSlotCount,
        },
        mandatory: options.mandatory,
        profile: options.profile,
      };
    },
  );

  typed.get(
    '/v1/catalog/topics',
    {
      preHandler: secured.preHandler,
      schema: {
        tags: ['catalog'],
        summary: 'Темы предмета',
        security: secured.security,
        querystring: topicsQuerySchema,
        response: {
          200: topicsResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const result = await listTopics(
        requireSql(app),
        request.query.subject_code,
        request.query.grade ?? null,
      );

      return {
        subject: result.subject,
        topics: result.topics.map((topic) => ({
          code: topic.code,
          title: topic.title,
          grade_min: topic.gradeMin,
          grade_max: topic.gradeMax,
          exam_weight: topic.examWeight,
          prerequisites: topic.prerequisites,
        })),
      };
    },
  );
}
