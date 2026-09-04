import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AnswerPayload } from '../../src/contracts/dto/attempts.js';
import type { Sql } from '../../src/db/sql.js';
import { previousDate } from '../../src/domain/daily.js';
import { parseAnswerKey } from '../../src/modules/attempts/grading.js';
import { saveAnswers, submitAttempt } from '../../src/modules/attempts/service.js';
import {
  generateTask,
  getDailyPlan,
  getStreak,
  skipItem,
  startItem,
} from '../../src/modules/daily/service.js';
import { bumpStreak, readStreak } from '../../src/modules/daily/streak.js';
import { completeOnboarding } from '../../src/modules/onboarding/service.js';
import { buildRoadmap } from '../../src/modules/roadmap/build.js';
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
    workerId: `worker-daily-${Math.random().toString(36).slice(2, 8)}`,
    maintenance: false,
  });

  await drainJobs(sql, worker, studentId);
}

async function studentWithPlanSource(): Promise<AuthUser> {
  const created = await createTestUser(sql, 'student', { grade: 11 });
  createdIds.push(created.id);
  const user = asAuth(created.id);

  const onboarding = await completeOnboarding(
    sql,
    user,
    {
      goal: 'ent',
      exam_code: 'ent',
      grade: 11,
      target_date: '2027-06-15',
      subject_codes: ['math', 'physics'],
      answers: null,
    },
    'daily-test',
  );

  const assessmentId = onboarding.diagnostic?.assessment_id;
  if (assessmentId === undefined) {
    throw new Error('диагностика не собралась — выполните npm run content');
  }

  const [attempt] = await sql<{ id: string }[]>`
    insert into public.attempts (student_id, assessment_id, status, submitted_at, graded_at)
    values (${user.id}, ${assessmentId}, 'graded', now(), now())
    returning id
  `;

  await sql`
    update public.student_profiles
       set diagnostic_attempt_id = ${attempt?.id ?? null}
     where student_id = ${user.id}
  `;

  const [subject] = await sql<{ subject_id: string }[]>`
    select ss.subject_id
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
     where ss.student_id = ${user.id} and ss.removed_at is null
     order by s.sort_order, s.code
     limit 1
  `;

  if (subject !== undefined) {
    await buildRoadmap(
      sql,
      {
        studentId: user.id,
        subjectId: subject.subject_id,
        aiJobId: null,
        replanReason: null,
        proposal: null,
      },
      { gradeMin: 7, gradeMax: 11 },
    );
  }

  return user;
}

async function passAttempt(user: AuthUser, assessmentId: string, attemptId: string): Promise<void> {
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

  for (const question of questions) {
    if (question.kind === 'free_text') {
      answers.push({
        question_id: question.id,
        answer: { text: 'Развёрнутый ответ ученика.' },
        time_spent_sec: 20,
      });
      continue;
    }

    const key = parseAnswerKey(question.answer_key);
    if (key === null) {
      continue;
    }
    if ('correct' in key) {
      answers.push({
        question_id: question.id,
        answer: { selected: [...key.correct] },
        time_spent_sec: 20,
      });
    } else if ('value' in key) {
      answers.push({ question_id: question.id, answer: { value: key.value }, time_spent_sec: 20 });
    }
  }

  await saveAnswers(sql, user, attemptId, { answers });
  await submitAttempt(sql, user, attemptId, {});
}

describe.skipIf(!hasDatabase())('дневной план и серия дней', () => {
  beforeAll(async () => {
    sql = createTestSql();
    app = await buildTestApp({ DATABASE_URL: process.env['DATABASE_URL'] ?? '' });
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  describe('создание плана', () => {
    it('собирает план при первом запросе дня', async () => {
      const user = await studentWithPlanSource();
      const response = await getDailyPlan(sql, user, undefined);

      expect(response.plan).not.toBeNull();
      expect(response.plan?.source).toBe('fallback');
      expect(response.items.length).toBeGreaterThan(0);
      expect(response.empty_reason).toBeNull();
    });

    it('параллельные запросы создают ровно один план', async () => {
      const user = await studentWithPlanSource();

      const [first, second, third] = await Promise.all([
        getDailyPlan(sql, user, undefined),
        getDailyPlan(sql, user, undefined),
        getDailyPlan(sql, user, undefined),
      ]);

      const [row] = await sql<{ count: string }[]>`
        select count(*) as count from public.daily_plans where student_id = ${user.id}
      `;

      expect(Number(row?.count)).toBe(1);
      expect(second.plan?.id).toBe(first.plan?.id);
      expect(third.plan?.id).toBe(first.plan?.id);
    });

    it('повторный запрос не пересобирает план', async () => {
      const user = await studentWithPlanSource();
      const first = await getDailyPlan(sql, user, undefined);
      const second = await getDailyPlan(sql, user, undefined);

      expect(second.plan?.generated_at).toBe(first.plan?.generated_at);
      expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    });

    it('не выдумывает план задним числом', async () => {
      const user = await studentWithPlanSource();
      const response = await getDailyPlan(sql, user, '2020-01-01');

      expect(response.plan).toBeNull();
      expect(response.items).toEqual([]);
    });

    it('пункты нумеруются подряд и ведут к уроку', async () => {
      const user = await studentWithPlanSource();
      const response = await getDailyPlan(sql, user, undefined);

      const positions = response.items.map((item) => item.position);
      expect(positions).toEqual(positions.map((_, index) => index + 1));

      expect(response.items.every((item) => item.lesson_id !== null)).toBe(true);
    });
  });

  describe('пункт плана', () => {
    it('пропуск закрывает пункт и двигает счётчик', async () => {
      const user = await studentWithPlanSource();
      const plan = await getDailyPlan(sql, user, undefined);
      const item = plan.items[0];

      if (item === undefined) {
        throw new Error('план пуст');
      }

      const result = await skipItem(sql, user, item.id);

      expect(result.item.status).toBe('skipped');
      expect(result.completed).toBe(1);
      expect(result.total).toBeGreaterThanOrEqual(plan.items.length);
    });

    it('выполненный пункт пропустить нельзя', async () => {
      const user = await studentWithPlanSource();
      const plan = await getDailyPlan(sql, user, undefined);
      const item = plan.items[0];

      if (item === undefined) {
        throw new Error('план пуст');
      }

      await sql`
        update public.daily_plan_items set status = 'completed', completed_at = now()
         where id = ${item.id}
      `;

      await expect(skipItem(sql, user, item.id)).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
    });

    it('старт урока открывает его сразу, без очереди', async () => {
      const user = await studentWithPlanSource();
      const plan = await getDailyPlan(sql, user, undefined);
      const lesson = plan.items.find((item) => item.kind === 'lesson');

      if (lesson === undefined) {
        throw new Error('в плане нет пункта с уроком');
      }

      const started = await startItem(sql, user, lesson.id, 'daily-test');

      expect(started.job).toBeNull();
      expect(started.lesson_id).toBe(lesson.lesson_id);
      expect(started.item.status).toBe('in_progress');
    });

    it('старт задачи заказывает набор вопросов', async () => {
      const user = await studentWithPlanSource();
      const plan = await getDailyPlan(sql, user, undefined);
      const task = plan.items.find((item) => item.kind !== 'lesson');

      if (task === undefined) {
        throw new Error('в плане нет пункта-задачи');
      }

      const started = await startItem(sql, user, task.id, 'daily-test');

      expect(started.job).not.toBeNull();
      expect(started.assessment_id).toBeNull();
    });

    it('чужой пункт неотличим от несуществующего', async () => {
      const owner = await studentWithPlanSource();
      const stranger = await studentWithPlanSource();
      const plan = await getDailyPlan(sql, owner, undefined);
      const item = plan.items[0];

      if (item === undefined) {
        throw new Error('план пуст');
      }

      await expect(skipItem(sql, stranger, item.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('серия дней', () => {
    it('пустая серия у нового ученика', async () => {
      const user = await studentWithPlanSource();
      const streak = await getStreak(sql, user);

      expect(streak.current).toBe(0);
      expect(streak.longest).toBe(0);
      expect(streak.today_completed).toBe(false);
    });

    it('повторное продление того же дня не увеличивает серию', async () => {
      const user = await studentWithPlanSource();
      const today = (await getStreak(sql, user)).date;

      await bumpStreak(sql, user.id, today);
      await bumpStreak(sql, user.id, today);
      await bumpStreak(sql, user.id, today);

      const streak = await readStreak(sql, user.id);
      expect(streak.current).toBe(1);
    });

    it('вчерашний день продлевает серию, а разрыв обнуляет', async () => {
      const user = await studentWithPlanSource();
      const today = (await getStreak(sql, user)).date;
      const yesterday = previousDate(today);

      await bumpStreak(sql, user.id, previousDate(yesterday));
      await bumpStreak(sql, user.id, yesterday);
      expect((await readStreak(sql, user.id)).current).toBe(2);

      await bumpStreak(sql, user.id, today);
      expect((await readStreak(sql, user.id)).current).toBe(3);

      const streak = await getStreak(sql, user);
      expect(streak.today_completed).toBe(true);
      expect(streak.longest).toBe(3);
    });

    it('«сегодня» считается по локальной дате ученика', async () => {
      const user = await studentWithPlanSource();

      await sql`update public.profiles set timezone = 'Asia/Almaty' where id = ${user.id}`;
      const almaty = await getStreak(sql, user);

      await sql`update public.profiles set timezone = 'Pacific/Honolulu' where id = ${user.id}`;
      const honolulu = await getStreak(sql, user);

      expect(almaty.date >= honolulu.date).toBe(true);
    });
  });

  describe('заказ задачи', () => {
    it('ставит работу и повторяется по ключу идемпотентности', async () => {
      const user = await studentWithPlanSource();
      const plan = await getDailyPlan(sql, user, undefined);
      const topicId = plan.items[0]?.topic.id;

      if (topicId === undefined) {
        throw new Error('план пуст');
      }

      const first = await generateTask(sql, user, { topic_id: topicId }, 'ключ-1');
      const second = await generateTask(sql, user, { topic_id: topicId }, 'ключ-1');

      expect(second.job_id).toBe(first.job_id);
      expect(second.created).toBe(false);
    });

    it('тема вне охвата ученика неотличима от несуществующей', async () => {
      const user = await studentWithPlanSource();

      const [foreign] = await sql<{ id: string }[]>`
        select t.id
          from public.topics t
          join public.subjects s on s.id = t.subject_id
         where s.code = 'biology' and t.is_active
         limit 1
      `;

      if (foreign === undefined) {
        throw new Error('в наполнении нет тем по биологии');
      }

      await expect(
        generateTask(sql, user, { topic_id: foreign.id }, null),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('сквозной путь', () => {
    it('решённая задача закрывает пункт, а последний — продлевает серию', async () => {
      const user = await studentWithPlanSource();
      const plan = await getDailyPlan(sql, user, undefined);

      if (plan.plan === null || plan.items.length === 0) {
        throw new Error('план пуст');
      }

      const [target, ...rest] = plan.items;
      if (target === undefined) {
        throw new Error('план пуст');
      }
      for (const item of rest) {
        await sql`
          update public.daily_plan_items
             set status = 'completed', completed_at = now()
           where id = ${item.id}
        `;
      }

      const assessmentId = await taskFromBank(user.id, target.topic.id);
      if (assessmentId === null) {
        return;
      }

      await sql`
        update public.daily_plan_items
           set kind = 'task', assessment_id = ${assessmentId}, status = 'pending'
         where id = ${target.id}
      `;

      const started = await startItem(sql, user, target.id, 'daily-test');
      if (started.attempt_id === null) {
        throw new Error('попытка не создалась');
      }

      await passAttempt(user, assessmentId, started.attempt_id);
      await drainQueue(user.id);

      const after = await getDailyPlan(sql, user, undefined);
      const closed = after.items.find((item) => item.id === target.id);

      expect(closed?.status).toBe('completed');
      expect(after.plan?.completed).toBe(after.plan?.total);

      const streak = await getStreak(sql, user);
      expect(streak.current).toBe(1);
      expect(streak.today_completed).toBe(true);
    }, 120_000);
  });
});

async function taskFromBank(studentId: string, topicId: string): Promise<string | null> {
  const questions = await sql<{ id: string; points: string; subject_id: string }[]>`
    select id, points, subject_id
      from public.questions
     where is_active and origin = 'bank' and topic_id = ${topicId}
     order by difficulty, id
     limit 5
  `;

  const first = questions[0];
  if (first === undefined) {
    return null;
  }

  const total = questions.reduce((sum, question) => sum + Number(question.points), 0);

  const [assessment] = await sql<{ id: string }[]>`
    insert into public.assessments (kind, title, subject_id, student_id, total_points, is_active)
    values ('ai_task', 'Задание (тест)', ${first.subject_id}, ${studentId}, ${total}, true)
    returning id
  `;

  if (assessment === undefined) {
    return null;
  }

  let position = 1;
  for (const question of questions) {
    await sql`
      insert into public.assessment_questions (assessment_id, question_id, position)
      values (${assessment.id}, ${question.id}, ${position})
    `;
    position += 1;
  }

  return assessment.id;
}
