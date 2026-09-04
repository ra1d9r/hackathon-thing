import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { weakEtag } from '../../src/plugins/etag.js';
import type { Sql } from '../../src/db/sql.js';
import { localDate } from '../../src/domain/day.js';
import { buildDashboard } from '../../src/modules/dashboard/service.js';
import { completeOnboarding } from '../../src/modules/onboarding/service.js';
import {
  buildOverview,
  buildScoreHistory,
  buildTopics,
  getPredictedScore,
  recordHeartbeat,
} from '../../src/modules/stats/service.js';
import { loadScoreContext } from '../../src/modules/stats/score.js';
import { parseAnswerKey } from '../../src/modules/attempts/grading.js';
import {
  saveAnswers,
  startAttempt,
  submitAttempt,
} from '../../src/modules/attempts/service.js';
import { runMaintenance } from '../../src/queue/maintenance.js';
import { QueueWorker } from '../../src/queue/worker.js';
import type { AuthUser } from '../../src/types/fastify.js';
import type { AnswerPayload } from '../../src/contracts/dto/attempts.js';
import { buildTestApp } from '../helpers/app.js';
import { cleanupTestUsers, createTestSql, createTestUser, hasDatabase } from '../helpers/db.js';
import { drainJobs } from '../helpers/queue.js';

let sql: Sql;
let app: FastifyInstance;
const createdIds: string[] = [];

function asAuth(id: string): AuthUser {
  return { id, role: 'student', publicId: 'TLK-TEST0000' };
}

interface QuestionRow {
  id: string;
  kind: string;
  answer_key: unknown;
  position: number;
}

async function drainQueue(studentId: string): Promise<void> {
  const worker = new QueueWorker({
    sql,
    log: app.log,
    workerId: `worker-dashboard-${Math.random().toString(36).slice(2, 8)}`,
    maintenance: false,
  });

  await drainJobs(sql, worker, studentId);
}

async function studentWithDiagnostic(): Promise<AuthUser> {
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
    'dashboard-test',
  );

  const assessmentId = onboarding.diagnostic?.assessment_id;
  if (assessmentId === undefined) {
    throw new Error('диагностика не собралась — выполните npm run content');
  }

  const view = await startAttempt(
    sql,
    user,
    { assessment_id: assessmentId, client_attempt_id: null },
    'dashboard-test',
  );

  const questions = await sql<QuestionRow[]>`
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
        time_spent_sec: 30,
      });
      continue;
    }

    const key = parseAnswerKey(question.answer_key);
    if (key === null) {
      continue;
    }

    const correct = question.position % 2 === 0;

    if ('correct' in key) {
      answers.push({
        question_id: question.id,
        answer: correct ? { selected: [...key.correct] } : { selected: ['zzz'] },
        time_spent_sec: 30,
      });
    } else if ('value' in key) {
      answers.push({
        question_id: question.id,
        answer: { value: correct ? key.value : key.value + 999 },
        time_spent_sec: 30,
      });
    }
  }

  await saveAnswers(sql, user, view.attempt.id, { answers });
  await submitAttempt(sql, user, view.attempt.id, {});
  await drainQueue(user.id);

  return user;
}

describe.skipIf(!hasDatabase())('дашборд и статистика', () => {
  beforeAll(async () => {
    sql = createTestSql();
    app = await buildTestApp({ DATABASE_URL: process.env['DATABASE_URL'] ?? '' });
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  describe('экран панели', () => {
    it('собирается целиком и согласован сам с собой', async () => {
      const user = await studentWithDiagnostic();
      const dashboard = await buildDashboard(sql, user);

      expect(dashboard.goal.kind).toBe('ent');
      expect(dashboard.goal.title).toBe('ЕНТ');
      expect(dashboard.goal.days_left).toBeGreaterThan(0);

      expect(dashboard.predicted_score).not.toBeNull();
      expect(dashboard.predicted_score?.max).toBe(140);
      expect(dashboard.predicted_score?.value).toBeGreaterThan(0);
      expect(dashboard.predicted_score?.value).toBeLessThanOrEqual(140);

      const [answers] = await sql<{ n: number }[]>`
        select count(*)::int as n
          from public.attempt_answers aa
          join public.attempts a on a.id = aa.attempt_id
         where a.student_id = ${user.id}
      `;
      expect(dashboard.analytics.questions_answered).toBe(answers?.n ?? 0);

      expect(dashboard.analytics.attempts_graded).toBe(1);
      expect(dashboard.daily_plan.empty_reason).toBe('not_generated_yet');

      const [jobs] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.ai_jobs
         where student_id = ${user.id}
           and status in ('queued','running','awaiting_retry')
      `;
      expect(dashboard.pending_ai.jobs).toBe(jobs?.n ?? 0);
      expect(dashboard.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    });

    it('фокус дня непуст и не меняется в течение дня', async () => {
      const user = await studentWithDiagnostic();

      const first = await buildDashboard(sql, user);
      const second = await buildDashboard(sql, user);

      expect(first.today_focus.length).toBeGreaterThan(0);
      expect(first.today_focus.length).toBeLessThanOrEqual(3);
      expect(second.today_focus.map((topic) => topic.topic_id)).toEqual(
        first.today_focus.map((topic) => topic.topic_id),
      );
    });

    it('в фокус попадают только проблемные темы', async () => {
      const user = await studentWithDiagnostic();
      const dashboard = await buildDashboard(sql, user);

      for (const topic of dashboard.today_focus) {
        expect(topic.mastery_pct).toBeLessThan(100);
        expect(['weak', 'improving']).toContain(topic.status);
      }
    });

    it('попадание в фокус запоминается — иначе список повторялся бы неделями', async () => {
      const user = await studentWithDiagnostic();
      const dashboard = await buildDashboard(sql, user);

      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.student_topic_mastery
         where student_id = ${user.id} and last_focus_date is not null
      `;

      expect(row?.n).toBe(dashboard.today_focus.length);
    });

    it('без первичного опроса отвечает понятным отказом', async () => {
      const created = await createTestUser(sql, 'student', { grade: 11 });
      createdIds.push(created.id);

      await expect(buildDashboard(sql, asAuth(created.id))).rejects.toMatchObject({
        code: 'ONBOARDING_INCOMPLETE',
      });
    });
  });

  describe('прогноз балла', () => {
    it('считается по чертежу и сохраняется в историю', async () => {
      const user = await studentWithDiagnostic();
      const score = await getPredictedScore(sql, user);

      expect(score).not.toBeNull();
      expect(score?.scale).toBe('points');
      expect(score?.max).toBe(140);

      expect(score?.baseline_value).toBe(score?.value);
      expect(score?.source).toBe('baseline');

      const [stored] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.predicted_scores where student_id = ${user.id}
      `;
      expect(stored?.n).toBeGreaterThan(0);
    });

    it('не бывает нулевым на тесте с выбором', async () => {
      const user = await studentWithDiagnostic();
      const context = await loadScoreContext(sql, user.id);

      expect(context?.baselineValue ?? 0).toBeGreaterThan(0);
    });

    it('разбивка по секциям покрывает весь чертёж', async () => {
      const user = await studentWithDiagnostic();
      const context = await loadScoreContext(sql, user.id);

      const total = (context?.sections ?? []).reduce(
        (sum, section) => sum + section.maxPoints,
        0,
      );
      expect(total).toBe(140);
    });

    it('история прогноза отдаётся точками для графика', async () => {
      const user = await studentWithDiagnostic();
      await getPredictedScore(sql, user);

      const history = await buildScoreHistory(sql, user, '90d');

      expect(history.points.length).toBeGreaterThan(0);
      expect(history.max).toBe(140);
      for (const point of history.points) {
        expect(point.at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
        expect(point.value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('разделы статистики', () => {
    it('сводка согласована с дашбордом', async () => {
      const user = await studentWithDiagnostic();

      const dashboard = await buildDashboard(sql, user);
      const overview = await buildOverview(sql, user);

      expect(overview.questions_answered).toBe(dashboard.analytics.questions_answered);
      expect(overview.attempts_graded).toBe(dashboard.analytics.attempts_graded);
      expect(overview.subjects.length).toBeGreaterThan(0);
      for (const subject of overview.subjects) {
        expect(subject.mastery_pct).toBeGreaterThanOrEqual(0);
        expect(subject.mastery_pct).toBeLessThanOrEqual(100);
      }
    });

    it('темы фильтруются по предмету и по статусу', async () => {
      const user = await studentWithDiagnostic();

      const all = await buildTopics(sql, user, { limit: 100 });
      const math = await buildTopics(sql, user, { subjectCode: 'math', limit: 100 });

      expect(all.topics.length).toBeGreaterThan(math.topics.length);
      expect(math.topics.every((topic) => topic.subject_code === 'math')).toBe(true);
    });

    it('пустота различает «нет свидетельств» и «фильтр ничего не нашёл»', async () => {
      const fresh = await createTestUser(sql, 'student', { grade: 11 });
      createdIds.push(fresh.id);
      await completeOnboarding(
        sql,
        asAuth(fresh.id),
        {
          goal: 'ent',
          exam_code: 'ent',
          grade: 11,
          target_date: null,
          subject_codes: ['math', 'physics'],
          answers: null,
        },
        'dashboard-test',
      );

      const noEvidence = await buildTopics(sql, asAuth(fresh.id), { limit: 100 });
      expect(noEvidence.empty_reason).toBe('no_evidence_yet');

      const user = await studentWithDiagnostic();
      const noMatch = await buildTopics(sql, user, { subjectCode: 'biology', limit: 100 });
      expect(noMatch.empty_reason).toBe('filter_matched_nothing');
    });
  });

  describe('время за обучением', () => {
    it('накапливается сигналами клиента', async () => {
      const user = await studentWithDiagnostic();

      const first = await recordHeartbeat(sql, user, {
        context: 'lesson',
        refId: null,
        seconds: 300,
      });
      const second = await recordHeartbeat(sql, user, {
        context: 'lesson',
        refId: null,
        seconds: 600,
      });

      expect(first.accepted_seconds).toBe(300);
      expect(second.accepted_seconds).toBe(600);
      expect(second.study_hours_today).toBeCloseTo(0.25, 2);
    });

    it('суточный предел не даёт засчитать забытую вкладку', async () => {
      const user = await studentWithDiagnostic();

      await sql`
        insert into public.study_sessions (student_id, context, started_at, ended_at, seconds)
        values (${user.id}, 'lesson', now(), now(), 43200)
      `;

      const extra = await recordHeartbeat(sql, user, {
        context: 'lesson',
        refId: null,
        seconds: 600,
      });

      expect(extra.accepted_seconds).toBe(0);
    });

    it('сутки считаются по часовому поясу ученика, а не по нашему', async () => {
      const user = await studentWithDiagnostic();

      const [bounds] = await sql<{ later: Date; later_zone: string; earlier_zone: string }[]>`
        with edges as (
          select date_trunc('day', now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty'
                   as almaty,
                 date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' as utc
        )
        select greatest(almaty, utc) as later,
               case when almaty > utc then 'Asia/Almaty' else 'UTC' end as later_zone,
               case when almaty > utc then 'UTC' else 'Asia/Almaty' end as earlier_zone
          from edges
      `;

      if (bounds === undefined) {
        throw new Error('границы суток не посчитались');
      }

      await sql`
        insert into public.study_sessions (student_id, context, started_at, ended_at, seconds)
        values (
          ${user.id}, 'lesson',
          ${bounds.later}::timestamptz - interval '1 second',
          ${bounds.later}::timestamptz - interval '1 second',
          43200
        )
      `;

      await sql`
        update public.profiles set timezone = ${bounds.later_zone} where id = ${user.id}
      `;
      const fresh = await recordHeartbeat(sql, user, {
        context: 'lesson',
        refId: null,
        seconds: 600,
      });
      expect(fresh.accepted_seconds).toBe(600);

      await sql`
        update public.profiles set timezone = ${bounds.earlier_zone} where id = ${user.id}
      `;
      const capped = await recordHeartbeat(sql, user, {
        context: 'lesson',
        refId: null,
        seconds: 600,
      });
      expect(capped.accepted_seconds).toBe(0);
    });

    it('испорченный часовой пояс не роняет накопление времени', async () => {
      const user = await studentWithDiagnostic();

      await sql`update public.profiles set timezone = 'Совсем/Не/Зона' where id = ${user.id}`;

      const beat = await recordHeartbeat(sql, user, {
        context: 'lesson',
        refId: null,
        seconds: 300,
      });

      expect(beat.accepted_seconds).toBe(300);
    });

    it('время попадает в аналитику', async () => {
      const user = await studentWithDiagnostic();
      await recordHeartbeat(sql, user, { context: 'assistant', refId: null, seconds: 1800 });

      const dashboard = await buildDashboard(sql, user);
      expect(dashboard.analytics.study_hours).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('ежедневное обновление приоритетов', () => {
    it('поднимает давно не повторявшуюся тему, не трогая мастерство', async () => {
      const user = await studentWithDiagnostic();

      await sql`
        update public.student_topic_mastery
           set last_evidence_at = now() - interval '30 days',
               updated_at = now() - interval '2 days'
         where student_id = ${user.id}
      `;

      const before = await sql<{ topic_id: string; priority: string; mastery_pct: string }[]>`
        select topic_id, priority, mastery_pct from public.student_topic_mastery
         where student_id = ${user.id} and status <> 'mastered' order by topic_id
      `;

      const report = await runMaintenance(sql, app.log);
      expect(report.prioritiesRefreshed).toBeGreaterThan(0);

      const after = await sql<{ topic_id: string; priority: string; mastery_pct: string }[]>`
        select topic_id, priority, mastery_pct from public.student_topic_mastery
         where student_id = ${user.id} and status <> 'mastered' order by topic_id
      `;

      expect(after.length).toBe(before.length);
      expect(before.length).toBeGreaterThan(0);

      for (const [index, row] of after.entries()) {
        const was = before[index];
        expect(row.topic_id).toBe(was?.topic_id);

        expect(Number(row.priority)).toBeGreaterThan(Number(was?.priority ?? 0));

        expect(Number(row.mastery_pct)).toBe(Number(was?.mastery_pct ?? -1));
      }
    });

    it('второй проход подряд не переписывает те же строки', async () => {
      const user = await studentWithDiagnostic();

      await sql`
        update public.student_topic_mastery
           set updated_at = now() - interval '2 days'
         where student_id = ${user.id}
      `;

      await runMaintenance(sql, app.log);

      const touched = await sql<{ n: number }[]>`
        select count(*)::int as n from public.student_topic_mastery
         where student_id = ${user.id} and updated_at < now() - interval '1 hour'
      `;

      expect(touched[0]?.n).toBe(0);

      const priorities = await sql<{ topic_id: string; priority: string }[]>`
        select topic_id, priority from public.student_topic_mastery
         where student_id = ${user.id} order by topic_id
      `;

      await runMaintenance(sql, app.log);

      const again = await sql<{ topic_id: string; priority: string }[]>`
        select topic_id, priority from public.student_topic_mastery
         where student_id = ${user.id} order by topic_id
      `;

      expect(again).toEqual(priorities);
    });
  });

  describe('пробник в прогнозе', () => {
    it('свежий пробник поднимает прогноз, просроченный — нет', async () => {
      const user = await studentWithDiagnostic();

      const [mock] = await sql<{ id: string }[]>`
        select id from public.assessments
         where kind = 'exam_mock' and is_active
         order by created_at limit 1
      `;
      if (mock === undefined) {
        throw new Error('пробник не загружен — выполните npm run content');
      }

      const view = await startAttempt(
        sql,
        user,
        { assessment_id: mock.id, client_attempt_id: null },
        'dashboard-test',
      );

      const questions = await sql<QuestionRow[]>`
        select q.id, q.kind::text as kind, q.answer_key, aq.position
          from public.assessment_questions aq
          join public.questions q on q.id = aq.question_id
         where aq.assessment_id = ${mock.id}
         order by aq.position
      `;

      const answers = questions.flatMap((question) => {
        const key = parseAnswerKey(question.answer_key);
        if (key === null || !('correct' in key)) {
          return [];
        }
        return [
          {
            question_id: question.id,
            answer: { selected: [...key.correct] },
            time_spent_sec: 20,
          },
        ];
      });

      expect(answers.length).toBeGreaterThan(0);

      await saveAnswers(sql, user, view.attempt.id, { answers });
      await submitAttempt(sql, user, view.attempt.id, {});
      await drainQueue(user.id);

      const [attempt] = await sql<{ status: string; score_pct: string | null }[]>`
        select status::text as status, score_pct from public.attempts
         where id = ${view.attempt.id}
      `;
      expect(attempt?.status).toBe('graded');
      expect(Number(attempt?.score_pct ?? 0)).toBe(100);

      const [snapshot] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.mastery_snapshots
         where student_id = ${user.id} and reason = 'mock'
      `;
      expect(snapshot?.n).toBeGreaterThan(0);

      const [events] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.stat_events
         where student_id = ${user.id} and source_id = ${view.attempt.id}
           and source_type = 'mock_attempt'
      `;
      expect(events?.n).toBeGreaterThan(0);

      const withMock = await loadScoreContext(sql, user.id);

      await sql`
        update public.attempts set submitted_at = now() - interval '100 days'
         where id = ${view.attempt.id}
      `;

      const withoutMock = await loadScoreContext(sql, user.id);

      expect(withMock?.baselineValue ?? 0).toBeGreaterThan(withoutMock?.baselineValue ?? 0);
    });
  });

  describe('условные ответы', () => {
    it('два одинаковых запроса дают одно и то же тело', async () => {
      const user = await studentWithDiagnostic();

      const first = await buildDashboard(sql, user);
      const second = await buildDashboard(sql, user);
      const third = await buildDashboard(sql, user);

      expect(weakEtag(second)).toBe(weakEtag(first));
      expect(weakEtag(third)).toBe(weakEtag(first));

      const topics = await buildTopics(sql, user, { limit: 100 });
      expect(weakEtag(await buildTopics(sql, user, { limit: 100 }))).toBe(weakEtag(topics));
    });

    it('одинаковые данные дают одинаковый отпечаток', async () => {
      const payload = { a: 1, list: [1, 2, 3] };
      expect(weakEtag(payload)).toBe(weakEtag({ a: 1, list: [1, 2, 3] }));
    });

    it('момент ответа на отпечаток не влияет', async () => {
      const first = weakEtag({ value: 1, computed_at: '2026-08-21T10:00:00.000Z' });
      const second = weakEtag({ value: 1, computed_at: '2026-08-21T11:00:00.000Z' });

      expect(first).toBe(second);
    });

    it('изменение данных меняет отпечаток', async () => {
      expect(weakEtag({ value: 1 })).not.toBe(weakEtag({ value: 2 }));
    });
  });

  describe('локальная дата ученика', () => {
    it('берётся по его часовому поясу, а не по нашему', () => {
      const moment = new Date('2026-08-21T19:30:00.000Z');

      expect(localDate('Asia/Almaty', moment)).toBe('2026-08-22');
      expect(localDate('UTC', moment)).toBe('2026-08-21');
    });

    it('испорченный часовой пояс не роняет экран', () => {
      expect(localDate('Совсем/Не/Зона', new Date('2026-08-21T10:00:00.000Z'))).toBe('2026-08-21');
    });
  });
});
