import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AnswerPayload } from '../../src/contracts/dto/attempts.js';
import type { Sql } from '../../src/db/sql.js';
import { parseAnswerKey } from '../../src/modules/attempts/grading.js';
import { getAttemptResult, saveAnswers, submitAttempt } from '../../src/modules/attempts/service.js';
import { getMock, listMocks, startMock } from '../../src/modules/mocks/service.js';
import { completeOnboarding } from '../../src/modules/onboarding/service.js';
import { QueueWorker } from '../../src/queue/worker.js';
import type { AuthUser } from '../../src/types/fastify.js';
import { buildTestApp } from '../helpers/app.js';
import { cleanupTestUsers, createTestSql, createTestUser, hasDatabase } from '../helpers/db.js';
import { drainJobs } from '../helpers/queue.js';

let sql: Sql;
let app: FastifyInstance;
const createdIds: string[] = [];

function asAuth(id: string): AuthUser {
  return { id, role: 'student', publicId: 'TLK-TEST0000' };
}

async function drainQueue(studentId: string): Promise<void> {
  const worker = new QueueWorker({
    sql,
    log: app.log,
    workerId: `worker-mocks-${Math.random().toString(36).slice(2, 8)}`,
    maintenance: false,
  });

  await drainJobs(sql, worker, studentId);
}

async function entStudent(subjects: string[] = ['math', 'physics']): Promise<AuthUser> {
  const created = await createTestUser(sql, 'student', { grade: 11 });
  createdIds.push(created.id);
  const user = asAuth(created.id);

  await completeOnboarding(
    sql,
    user,
    {
      goal: 'ent',
      exam_code: 'ent',
      grade: 11,
      target_date: '2027-06-15',
      subject_codes: subjects,
      answers: null,
    },
    'mocks-test',
  );

  return user;
}

async function examIdByCode(code: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    select id from public.exam_profiles where code = ${code}
  `;
  if (row === undefined) {
    throw new Error(`экзамен ${code} не найден`);
  }
  return row.id;
}

async function answerMock(
  user: AuthUser,
  assessmentId: string,
  attemptId: string,
  correctness: number,
): Promise<void> {
  const questions = await sql<
    { id: string; kind: string; answer_key: unknown; position: number }[]
  >`
    select q.id, q.kind::text as kind, q.answer_key, aq.position
      from public.assessment_questions aq
      join public.questions q on q.id = aq.question_id
     where aq.assessment_id = ${assessmentId}
     order by aq.position
  `;

  const answers: { question_id: string; answer: AnswerPayload; time_spent_sec: number }[] = [];
  const correctUpTo = Math.round(questions.length * correctness);

  for (const question of questions) {
    const key = parseAnswerKey(question.answer_key);
    if (key === null) {
      continue;
    }

    const correct = question.position <= correctUpTo;

    if ('correct' in key) {
      answers.push({
        question_id: question.id,
        answer: correct ? { selected: [...key.correct] } : { selected: ['zzz'] },
        time_spent_sec: 10,
      });
    } else if ('value' in key) {
      answers.push({
        question_id: question.id,
        answer: { value: correct ? key.value : key.value + 999 },
        time_spent_sec: 10,
      });
    }
  }

  await saveAnswers(sql, user, attemptId, { answers });
  await submitAttempt(sql, user, attemptId, {});
}

describe.skipIf(!hasDatabase())('пробники экзаменов', () => {
  beforeAll(async () => {
    sql = createTestSql();
    app = await buildTestApp({ DATABASE_URL: process.env['DATABASE_URL'] ?? '' });
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  describe('список и структура', () => {
    it('экзамен ученика идёт первым и готов к прохождению', async () => {
      const user = await entStudent();
      const list = await listMocks(sql, user);

      expect(list.exams.length).toBeGreaterThan(0);
      expect(list.exams[0]?.is_target).toBe(true);
      expect(list.exams[0]?.code).toBe('ent');
      expect(list.exams[0]?.ready).toBe(true);
      expect(list.exams[0]?.question_count).toBe(120);
    });

    it('показывает профильные предметы, под которые собирается пробник', async () => {
      const user = await entStudent(['biology', 'chemistry']);
      const list = await listMocks(sql, user);

      expect(list.profile_subjects.map((subject) => subject.code).sort()).toEqual([
        'biology',
        'chemistry',
      ]);
    });

    it('структура повторяет чертёж экзамена', async () => {
      const user = await entStudent();
      const detail = await getMock(sql, user, await examIdByCode('ent'));

      expect(detail.sections).toHaveLength(5);
      expect(detail.sections.reduce((sum, section) => sum + section.max_points, 0)).toBe(140);

      for (const section of detail.sections) {
        expect(section.available).toBe(section.question_count);
      }
    });

    it('несуществующий экзамен даёт 404', async () => {
      const user = await entStudent();

      await expect(
        getMock(sql, user, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('старт', () => {
    it('собирает пробник на 120 заданий под пару ученика', async () => {
      const user = await entStudent();
      const started = await startMock(sql, user, await examIdByCode('ent'), 'mocks-test');

      expect(started.question_count).toBe(120);
      expect(started.shortfall).toEqual([]);
      expect(started.deadline_at).not.toBeNull();
    });

    it('повторный старт возвращает ту же попытку, а не собирает вторую', async () => {
      const user = await entStudent();
      const examId = await examIdByCode('ent');

      const first = await startMock(sql, user, examId, 'mocks-test');
      const second = await startMock(sql, user, examId, 'mocks-test');

      expect(second.attempt_id).toBe(first.attempt_id);
      expect(second.assessment_id).toBe(first.assessment_id);
    });

    it('у разных пар профильных предметов состав различается', async () => {
      const examId = await examIdByCode('ent');
      const first = await entStudent(['math', 'physics']);
      const second = await entStudent(['biology', 'chemistry']);

      const a = await startMock(sql, first, examId, 'mocks-test');
      const b = await startMock(sql, second, examId, 'mocks-test');

      const subjectsOf = async (assessmentId: string): Promise<string[]> => {
        const rows = await sql<{ code: string }[]>`
          select distinct s.code
            from public.assessment_questions aq
            join public.questions q on q.id = aq.question_id
            join public.subjects s on s.id = q.subject_id
           where aq.assessment_id = ${assessmentId}
           order by s.code
        `;
        return rows.map((row) => row.code);
      };

      const codesA = await subjectsOf(a.assessment_id);
      const codesB = await subjectsOf(b.assessment_id);

      expect(codesA).toContain('physics');
      expect(codesB).toContain('biology');
      expect(codesB).not.toContain('physics');
    });

    it('незавершённая попытка видна в структуре пробника', async () => {
      const user = await entStudent();
      const examId = await examIdByCode('ent');

      const started = await startMock(sql, user, examId, 'mocks-test');
      const detail = await getMock(sql, user, examId);

      expect(detail.active_attempt_id).toBe(started.attempt_id);
    });
  });

  describe('сквозной проход', () => {
    it('результат приводится к шкале экзамена и разбирается без ИИ', async () => {
      const user = await entStudent();
      const started = await startMock(sql, user, await examIdByCode('ent'), 'mocks-test');

      await answerMock(user, started.assessment_id, started.attempt_id, 0.5);
      await drainQueue(user.id);

      const result = await getAttemptResult(sql, user, started.attempt_id);

      expect(result.attempt.status).toBe('graded');
      expect(result.exam).not.toBeNull();
      expect(result.exam?.exam.code).toBe('ent');
      expect(result.exam?.max_score).toBe(140);

      const score = result.exam?.scaled_score ?? 0;
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(140);

      expect(result.exam?.sections).toHaveLength(5);
      expect(
        (result.exam?.sections ?? []).reduce((sum, section) => sum + section.max_points, 0),
      ).toBe(140);

      expect(result.analysis?.source).toBe('fallback');
      expect(result.job).toBeNull();
    }, 180_000);

    it('первый пробник не показывает разницу с предыдущим', async () => {
      const user = await entStudent();
      const started = await startMock(sql, user, await examIdByCode('ent'), 'mocks-test');

      await answerMock(user, started.assessment_id, started.attempt_id, 0.3);
      await drainQueue(user.id);

      const result = await getAttemptResult(sql, user, started.attempt_id);
      expect(result.exam?.delta_vs_previous).toBeNull();
    }, 180_000);

    it('у обычной попытки разбивки по секциям нет', async () => {
      const user = await entStudent();

      const [diagnostic] = await sql<{ id: string }[]>`
        select a.id
          from public.assessments a
         where a.kind = 'diagnostic' and a.student_id = ${user.id} and a.is_active
         limit 1
      `;

      if (diagnostic === undefined) {
        throw new Error('диагностика не собралась');
      }

      const [attempt] = await sql<{ id: string }[]>`
        insert into public.attempts (student_id, assessment_id, status, submitted_at, graded_at)
        values (${user.id}, ${diagnostic.id}, 'graded', now(), now())
        returning id
      `;

      const result = await getAttemptResult(sql, user, attempt?.id ?? '');
      expect(result.exam).toBeNull();
    });
  });
});
