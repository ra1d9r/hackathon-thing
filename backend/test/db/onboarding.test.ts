import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorEnvelopeSchema } from '../../src/contracts/errors.js';
import {
  completeOnboardingResponseSchema,
  goalsResponseSchema,
  subjectOptionsResponseSchema,
  topicsResponseSchema,
} from '../../src/contracts/dto/onboarding.js';
import type { Sql } from '../../src/db/sql.js';
import { completeOnboarding, updateLearningProfile } from '../../src/modules/onboarding/service.js';
import { listGoals, listSubjectOptions } from '../../src/modules/catalog/service.js';
import { assembleDiagnostic } from '../../src/modules/onboarding/diagnostic.js';
import { curriculumScope } from '../../src/domain/curriculum-scope.js';
import { buildTestApp } from '../helpers/app.js';
import { cleanupTestUsers, createTestSql, createTestUser, hasDatabase } from '../helpers/db.js';
import type { AuthUser } from '../../src/types/fastify.js';

let sql: Sql;
let app: FastifyInstance;
const createdIds: string[] = [];

function asAuth(id: string): AuthUser {
  return { id, role: 'student', publicId: 'TLK-TEST0000' };
}

describe.skipIf(!hasDatabase())('онбординг и каталог', () => {
  beforeAll(async () => {
    sql = createTestSql();
    app = await buildTestApp({
      DATABASE_URL: process.env['DATABASE_URL'] ?? '',
      SUPABASE_URL: process.env['SUPABASE_URL'] ?? '',
      SUPABASE_SECRET_KEY: process.env['SUPABASE_SECRET_KEY'] ?? '',
    });
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  async function newStudent(grade = 11): Promise<AuthUser> {
    const user = await createTestUser(sql, 'student', { grade });
    createdIds.push(user.id);
    return asAuth(user.id);
  }

  describe('каталог', () => {
    it('перечисляет цели вместе с экзаменами', async () => {
      const goals = await listGoals(sql);
      const codes = goals.map((goal) => goal.goal).sort();

      expect(codes).toEqual(['ent', 'nis', 'subjects']);

      const ent = goals.find((goal) => goal.goal === 'ent');
      expect(ent?.exams).toHaveLength(1);
      expect(ent?.exams[0]).toMatchObject({ code: 'ent', maxScore: 140, profileSlotCount: 2 });

      const subjects = goals.find((goal) => goal.goal === 'subjects');
      expect(subjects?.exams).toEqual([]);
    });

    it('НИШ активен и имеет собственный чертёж по программе 5–6 классов', async () => {
      const goals = await listGoals(sql);
      const nis = goals.find((goal) => goal.goal === 'nis');

      expect(nis?.exams[0]).toMatchObject({
        code: 'nis',
        scale: 'points',
        profileSlotCount: 0,
        gradeMin: 5,
        gradeMax: 6,
      });
    });

    it('ЕНТ идёт по программе старших классов и знает свои пары предметов', async () => {
      const options = await listSubjectOptions(sql, 'ent');
      const goals = await listGoals(sql);
      const ent = goals.find((goal) => goal.goal === 'ent')?.exams[0];

      expect(ent).toMatchObject({ gradeMin: 7, gradeMax: 11 });

      const pairs = options.profilePairs.map((pair) => [...pair.codes].sort().join('+'));
      expect(pairs).toContain('math+physics');
      expect(pairs).not.toContain('biology+math');
    });

    it('делит предметы ЕНТ на обязательные и профильные', async () => {
      const options = await listSubjectOptions(sql, 'ent');

      expect(options.mandatory.map((option) => option.code)).toEqual([
        'kz_history',
        'reading_literacy',
        'math_literacy',
      ]);
      expect(options.profile.map((option) => option.code)).toContain('math');
      expect(options.profile.map((option) => option.code)).toContain('physics');
    });

    it('для цели без экзамена отдаёт все активные предметы', async () => {
      const options = await listSubjectOptions(sql, null);

      expect(options.mandatory).toEqual([]);
      expect(options.profile.length).toBeGreaterThanOrEqual(13);
    });

    it('схемы ответов каталога описаны в контракте', () => {
      expect(goalsResponseSchema.safeParse({}).success).toBe(false);
      expect(subjectOptionsResponseSchema.safeParse({}).success).toBe(false);
      expect(topicsResponseSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('правила выбора предметов', () => {
    it('ЕНТ требует ровно двух профильных предметов', async () => {
      const user = await newStudent();

      await expect(
        completeOnboarding(
          sql,
          user,
          {
            goal: 'ent',
            exam_code: 'ent',
            grade: 11,
            target_date: null,
            subject_codes: ['math'],
            answers: null,
          },
          'test',
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('пара профильных предметов должна быть из утверждённых', async () => {
      const user = await newStudent();

      await expect(
        completeOnboarding(
          sql,
          user,
          {
            goal: 'ent',
            exam_code: 'ent',
            grade: 11,
            target_date: null,
            subject_codes: ['math', 'biology'],
            answers: null,
          },
          'test',
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('утверждённая пара принимается', async () => {
      const user = await newStudent();

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['biology', 'chemistry'],
          answers: null,
        },
        'test',
      );

      expect(result.subjects.filter((subject) => subject.is_profile).map((s) => s.code).sort()).toEqual([
        'biology',
        'chemistry',
      ]);
    });

    it('нельзя выбрать предмет, которого нет среди профильных', async () => {
      const user = await newStudent();

      await expect(
        completeOnboarding(
          sql,
          user,
          {
            goal: 'ent',
            exam_code: 'ent',
            grade: 11,
            target_date: null,
            subject_codes: ['math', 'kazakh_language'],
            answers: null,
          },
          'test',
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('экзамен должен относиться к выбранной цели', async () => {
      const user = await newStudent();

      await expect(
        completeOnboarding(
          sql,
          user,
          {
            goal: 'nis',
            exam_code: 'ent',
            grade: 11,
            target_date: null,
            subject_codes: ['math'],
            answers: null,
          },
          'test',
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('у цели «подтянуть предметы» экзамена быть не должно', async () => {
      const user = await newStudent();

      await expect(
        completeOnboarding(
          sql,
          user,
          {
            goal: 'subjects',
            exam_code: 'ent',
            grade: 11,
            target_date: null,
            subject_codes: ['math'],
            answers: null,
          },
          'test',
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('несуществующий предмет отклоняется', async () => {
      const user = await newStudent();

      await expect(
        completeOnboarding(
          sql,
          user,
          {
            goal: 'subjects',
            exam_code: null,
            grade: 11,
            target_date: null,
            subject_codes: ['такого-нет'],
            answers: null,
          },
          'test',
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('охват программы', () => {
    it('НИШ собирает диагностику по 5–6 классам, а не по классу ученика', async () => {
      const created = await createTestUser(sql, 'student', { grade: 6 });
      createdIds.push(created.id);
      const user = asAuth(created.id);

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'nis',
          exam_code: 'nis',
          grade: 6,
          target_date: null,
          subject_codes: [],
          answers: null,
        },
        'test',
      );

      const assessmentId = result.diagnostic?.assessment_id;
      expect(assessmentId).toBeTypeOf('string');

      const grades = await sql<{ grade_min: number; grade_max: number }[]>`
        select t.grade_min, t.grade_max
          from public.assessment_questions aq
          join public.questions q on q.id = aq.question_id
          join public.topics t on t.id = q.topic_id
         where aq.assessment_id = ${assessmentId ?? ''}
      `;

      expect(grades.length).toBeGreaterThan(0);

      for (const row of grades) {
        expect(row.grade_min).toBeLessThanOrEqual(6);
      }
    });

    it('ЕНТ не берёт в диагностику темы младших классов', async () => {
      const user = await newStudent();

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: null,
        },
        'test',
      );

      const grades = await sql<{ grade_max: number }[]>`
        select t.grade_max
          from public.assessment_questions aq
          join public.questions q on q.id = aq.question_id
          join public.topics t on t.id = q.topic_id
         where aq.assessment_id = ${result.diagnostic?.assessment_id ?? ''}
      `;

      expect(grades.length).toBeGreaterThan(0);
      for (const row of grades) {
        expect(row.grade_max).toBeGreaterThanOrEqual(7);
      }
    });
  });

  describe('завершение онбординга', () => {
    it('добавляет обязательные предметы сам и собирает диагностику', async () => {
      const user = await newStudent();

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: '2027-06-15',
          subject_codes: ['math', 'physics'],
          answers: { source: 'test' },
        },
        'test',
      );

      const codes = result.subjects.map((subject) => subject.code).sort();
      expect(codes).toEqual(['kz_history', 'math', 'math_literacy', 'physics', 'reading_literacy']);

      const profile = result.subjects.filter((subject) => subject.is_profile).map((s) => s.code).sort();
      expect(profile).toEqual(['math', 'physics']);

      expect(result.diagnostic).not.toBeNull();
      expect(result.diagnostic?.question_count).toBeGreaterThanOrEqual(4);
      expect(result.diagnostic?.time_limit_sec).toBeGreaterThanOrEqual(600);

      expect(completeOnboardingResponseSchema.safeParse({
        onboarding_completed: true,
        goal: result.goal,
        exam_code: result.examCode,
        subjects: result.subjects,
        diagnostic: result.diagnostic,
      }).success).toBe(true);
    });

    it('диагностика покрывает все выбранные предметы', async () => {
      const user = await newStudent();

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: null,
        },
        'test',
      );

      const covered = result.diagnostic?.subjects.map((subject) => subject.code).sort() ?? [];
      expect(covered).toContain('math');
      expect(covered).toContain('physics');
      expect(covered).toContain('kz_history');
    });

    it('в диагностику попадают вопросы со свободным ответом', async () => {
      const user = await newStudent();

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: null,
        },
        'test',
      );

      expect(result.diagnostic?.free_text_count).toBeGreaterThan(0);
    });

    it('в диагностику не попадают вопросы пробников', async () => {
      const user = await newStudent();

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: null,
        },
        'test',
      );

      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n
          from public.assessment_questions aq
          join public.questions q on q.id = aq.question_id
         where aq.assessment_id = ${result.diagnostic?.assessment_id ?? null}
           and q.bank_pool <> 'diagnostic'
      `;

      expect(row?.n).toBe(0);
    });

    it('повторный вызов отклоняется', async () => {
      const user = await newStudent();
      const payload = {
        goal: 'ent' as const,
        exam_code: 'ent',
        grade: 11,
        target_date: null,
        subject_codes: ['math', 'physics'],
        answers: null,
      };

      await completeOnboarding(sql, user, payload, 'test');

      await expect(completeOnboarding(sql, user, payload, 'test')).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
    });

    it('сборка диагностики идемпотентна', async () => {
      const user = await newStudent();

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: null,
        },
        'test',
      );

      const subjectIds = await sql<{ subject_id: string }[]>`
        select subject_id from public.student_subjects
         where student_id = ${user.id} and removed_at is null
      `;

      const again = await assembleDiagnostic(
        sql,
        user.id,
        11,
        subjectIds.map((row) => row.subject_id),
        curriculumScope({ goal: 'ent', grade: 11, exam: { gradeMin: 7, gradeMax: 11 } }),
      );

      expect(again.diagnostic?.assessment_id).toBe(result.diagnostic?.assessment_id);
    });

    it('сохраняет сырой снимок ответов опросника', async () => {
      const user = await newStudent();

      await completeOnboarding(
        sql,
        user,
        {
          goal: 'subjects',
          exam_code: null,
          grade: 10,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: { источник: 'тест', шаг: 3 },
        },
        'test',
      );

      const [row] = await sql<{ answers: { goal: string; raw?: { источник?: string } } }[]>`
        select answers from public.onboarding_answers where student_id = ${user.id}
      `;

      expect(row?.answers.goal).toBe('subjects');
      expect(row?.answers.raw?.источник).toBe('тест');
    });

    it('нехватка вопросов не срывает онбординг', async () => {
      const user = await newStudent(9);

      const result = await completeOnboarding(
        sql,
        user,
        {
          goal: 'subjects',
          exam_code: null,
          grade: 9,
          target_date: null,

          subject_codes: ['biology'],
          answers: null,
        },
        'test',
      );

      expect(result.diagnostic).toBeNull();
      expect(result.diagnosticUnavailableReason).toBe('not_enough_questions');

      const [row] = await sql<{ onboarding_completed_at: Date | null }[]>`
        select onboarding_completed_at
          from public.student_profiles
         where student_id = ${user.id}
      `;
      expect(row?.onboarding_completed_at).not.toBeNull();
    });

    it('класс ученика обновляется по ответу опросника', async () => {
      const user = await newStudent(11);

      await completeOnboarding(
        sql,
        user,
        {
          goal: 'subjects',
          exam_code: null,
          grade: 9,
          target_date: null,
          subject_codes: ['math'],
          answers: null,
        },
        'test',
      );

      const [row] = await sql<{ grade: number }[]>`
        select grade from public.profiles where id = ${user.id}
      `;

      expect(row?.grade).toBe(9);
    });
  });

  describe('смена цели и предметов после онбординга', () => {
    it('меняет цель, сохраняя диагностику', async () => {
      const user = await newStudent();

      const initial = await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: null,
        },
        'test',
      );

      const updated = await updateLearningProfile(
        sql,
        user,
        { goal: 'subjects', exam_code: null, subject_codes: ['math'] },
        'test',
      );

      expect(updated.goal).toBe('subjects');
      expect(updated.examCode).toBeNull();
      expect(updated.diagnostic?.assessment_id).toBe(initial.diagnostic?.assessment_id);
    });

    it('убранный предмет помечается, а не удаляется', async () => {
      const user = await newStudent();

      await completeOnboarding(
        sql,
        user,
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: null,
        },
        'test',
      );

      await updateLearningProfile(
        sql,
        user,
        { goal: 'subjects', exam_code: null, subject_codes: ['math'] },
        'test',
      );

      const [removed] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.student_subjects
         where student_id = ${user.id} and removed_at is not null
      `;

      expect(removed?.n).toBeGreaterThan(0);
    });

    it('до онбординга изменение профиля отклоняется', async () => {
      const user = await newStudent();

      await expect(
        updateLearningProfile(sql, user, { subject_codes: ['math'] }, 'test'),
      ).rejects.toMatchObject({ code: 'ONBOARDING_INCOMPLETE' });
    });
  });

  describe('доступ', () => {
    it.each([
      ['/v1/catalog/goals'],
      ['/v1/catalog/subjects?goal=ent&exam_code=ent'],
      ['/v1/catalog/topics?subject_code=math'],
    ])('маршрут %s закрыт без токена', async (url) => {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(401);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('UNAUTHENTICATED');
    });

    it('завершение онбординга закрыто без токена', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/onboarding/complete',
        payload: { goal: 'ent', exam_code: 'ent', grade: 11, subject_codes: ['math', 'physics'] },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
