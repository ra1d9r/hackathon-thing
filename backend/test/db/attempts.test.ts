import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { z } from 'zod';

import type { AnswerPayload } from '../../src/contracts/dto/attempts.js';
import { AppError } from '../../src/contracts/errors.js';
import type { Sql } from '../../src/db/sql.js';
import { completeOnboarding } from '../../src/modules/onboarding/service.js';
import {
  abandonAttempt,
  getAttempt,
  getAttemptResult,
  getDiagnosticState,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from '../../src/modules/attempts/service.js';
import { parseAnswerKey } from '../../src/modules/attempts/grading.js';
import { NEUTRAL_BASELINE_PCT } from '../../src/domain/mastery.js';
import { runMaintenance } from '../../src/queue/maintenance.js';
import { QueueWorker } from '../../src/queue/worker.js';
import type { AuthUser } from '../../src/types/fastify.js';
import { buildTestApp } from '../helpers/app.js';
import { cleanupTestUsers, createTestSql, createTestUser, hasDatabase } from '../helpers/db.js';
import { drainJobs } from '../helpers/queue.js';

let sql: Sql;
let app: FastifyInstance;
let worker: QueueWorker;
const createdIds: string[] = [];

function asAuth(id: string): AuthUser {
  return { id, role: 'student', publicId: 'TLK-TEST0000' };
}

async function drainQueue(studentId: string): Promise<void> {
  await drainJobs(sql, worker, studentId);
}

const optionIdsSchema = z.array(z.object({ id: z.string() }));

interface QuestionKeyRow {
  id: string;
  kind: string;
  options: unknown;
  answer_key: unknown;
  points: string;
  topic_id: string;
}

function answerFor(question: QuestionKeyRow, correct: boolean): AnswerPayload | null {
  const key = parseAnswerKey(question.answer_key);

  if (question.kind === 'free_text') {
    return { text: 'Развёрнутый ответ ученика для проверки моделью.' };
  }
  if (key === null) {
    return null;
  }

  if ('correct' in key) {
    if (correct) {
      return { selected: [...key.correct] };
    }
    const options = optionIdsSchema.safeParse(question.options);
    const wrong = (options.success ? options.data : [])
      .map((option) => option.id)
      .find((id) => !key.correct.includes(id));

    return wrong === undefined ? { selected: [] } : { selected: [wrong] };
  }

  if ('value' in key) {
    return { value: correct ? key.value : key.value + 1000 };
  }

  return null;
}

async function questionsOf(assessmentId: string): Promise<QuestionKeyRow[]> {
  return sql<QuestionKeyRow[]>`
    select q.id, q.kind::text as kind, q.options, q.answer_key,
           coalesce(aq.points_override, q.points) as points, q.topic_id
      from public.assessment_questions aq
      join public.questions q on q.id = aq.question_id
     where aq.assessment_id = ${assessmentId}
     order by aq.position
  `;
}

async function newStudentWithDiagnostic(): Promise<{ user: AuthUser; assessmentId: string }> {
  const created = await createTestUser(sql, 'student', { grade: 11 });
  createdIds.push(created.id);
  const user = asAuth(created.id);

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
    'test-request',
  );

  const assessmentId = result.diagnostic?.assessment_id;
  if (assessmentId === undefined) {
    throw new Error('диагностика не собралась — загрузите наполнение: npm run content');
  }

  return { user, assessmentId };
}

describe.skipIf(!hasDatabase())('попытки, оценивание и очередь', () => {
  beforeAll(async () => {
    sql = createTestSql();
    app = await buildTestApp({ DATABASE_URL: process.env['DATABASE_URL'] ?? '' });
    worker = new QueueWorker({
      sql,
      log: app.log,
      workerId: 'worker-attempts-test',
      maintenance: false,
    });
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  describe('сквозной проход диагностики', () => {
    it('от старта до результата с процентами по темам', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();

      const state = await getDiagnosticState(sql, user);
      expect(state.state).toBe('available');
      expect(state.assessment?.id).toBe(assessmentId);

      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      expect(view.attempt.status).toBe('in_progress');
      expect(view.questions.length).toBeGreaterThan(0);

      const serialized = JSON.stringify(view.questions);
      expect(serialized).not.toContain('answer_key');
      expect(serialized).not.toContain('explanation_md');

      const questions = await questionsOf(assessmentId);

      const firstQuestion = questions.find(
        (question) => question.kind !== 'free_text' && parseAnswerKey(question.answer_key) !== null,
      );
      if (firstQuestion === undefined) {
        throw new Error('в диагностике нет вопросов с детерминированной проверкой');
      }

      const payload = questions
        .map((question) => {
          const answer = answerFor(question, question.id !== firstQuestion.id);
          return answer === null ? null : { question_id: question.id, answer, time_spent_sec: 30 };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const saved = await saveAnswers(sql, user, view.attempt.id, { answers: payload });
      expect(saved.saved).toBe(payload.length);
      expect(saved.answered_count).toBe(payload.length);

      const submitted = await submitAttempt(sql, user, view.attempt.id, {
        requestId: 'test-request',
      });

      expect(submitted.attempt.status).toBe('grading');
      expect(submitted.attempt.deterministic.max_score).toBeGreaterThan(0);
      expect(submitted.attempt.deterministic.raw_score).toBeLessThan(
        submitted.attempt.deterministic.max_score,
      );
      expect(submitted.job).not.toBeNull();

      await drainQueue(user.id);

      const result = await getAttemptResult(sql, user, view.attempt.id);

      expect(result.attempt.status).toBe('graded');
      expect(result.attempt.score_pct).not.toBeNull();
      expect(result.topics.length).toBeGreaterThan(0);

      const subjectCodes = result.subjects.map((subject) => subject.code);
      expect(subjectCodes).toContain('math');
      expect(subjectCodes).toContain('physics');

      for (const topic of result.topics) {
        expect(topic.pct).toBeGreaterThanOrEqual(0);
        expect(topic.pct).toBeLessThanOrEqual(100);
        expect(topic.mastery_pct).not.toBeNull();
      }

      const answered = result.answers.find((answer) => answer.question_id === firstQuestion.id);
      expect(answered?.is_correct).toBe(false);
      expect(answered?.correct_answer).not.toBeNull();

      expect(result.analysis?.source).toBe('fallback');
      expect(result.job).toBeNull();

      const finalState = await getDiagnosticState(sql, user);
      expect(finalState.state).toBe('completed');
    });

    it('первый замер стягивается к нейтральному тем сильнее, чем тоньше свидетельство', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      const questions = await questionsOf(assessmentId);
      const payload = questions
        .map((question) => {
          const answer = answerFor(question, true);
          return answer === null ? null : { question_id: question.id, answer, time_spent_sec: 10 };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      await saveAnswers(sql, user, view.attempt.id, { answers: payload });
      await submitAttempt(sql, user, view.attempt.id, {});
      await drainQueue(user.id);

      const mastery = await sql<{ mastery_pct: string; confidence: string }[]>`
        select mastery_pct, confidence
          from public.student_topic_mastery
         where student_id = ${user.id}
      `;

      expect(mastery.length).toBeGreaterThan(0);

      let thinEvidenceSeen = false;

      for (const row of mastery) {
        const value = Number(row.mastery_pct);
        expect(value).toBeGreaterThanOrEqual(NEUTRAL_BASELINE_PCT);
        expect(value).toBeLessThanOrEqual(100);
        if (value < 100) {
          thinEvidenceSeen = true;
        }

        expect(Number(row.confidence)).toBeLessThan(1);
      }

      expect(thinEvidenceSeen, 'ожидалась хотя бы одна тема с тонким свидетельством').toBe(true);

      const [snapshot] = await sql<{ reason: string }[]>`
        select reason from public.mastery_snapshots where student_id = ${user.id}
      `;
      expect(snapshot?.reason).toBe('diagnostic');

      const [profile] = await sql<{ diagnostic_attempt_id: string | null }[]>`
        select diagnostic_attempt_id from public.student_profiles where student_id = ${user.id}
      `;
      expect(profile?.diagnostic_attempt_id).toBe(view.attempt.id);
    });
  });

  describe('идемпотентность на уровне домена', () => {
    it('повторный старт возвращает ту же попытку', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();

      const first = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: 'client-attempt-0001' },
        'test-request',
      );
      const second = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: 'client-attempt-0001' },
        'test-request',
      );

      expect(second.attempt.id).toBe(first.attempt.id);

      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.attempts where student_id = ${user.id}
      `;
      expect(count?.n).toBe(1);
    });

    it('двойная отправка не создаёт вторую работу и не удваивает статистику', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      const questions = await questionsOf(assessmentId);
      const payload = questions
        .map((question) => {
          const answer = answerFor(question, true);
          return answer === null ? null : { question_id: question.id, answer, time_spent_sec: 5 };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      await saveAnswers(sql, user, view.attempt.id, { answers: payload });
      await submitAttempt(sql, user, view.attempt.id, {});

      await expect(submitAttempt(sql, user, view.attempt.id, {})).rejects.toMatchObject({
        code: 'ATTEMPT_ALREADY_SUBMITTED',
      });

      await drainQueue(user.id);

      const [events] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.stat_events
         where student_id = ${user.id} and source_id = ${view.attempt.id}
      `;

      const [topics] = await sql<{ n: number }[]>`
        select count(distinct topic_id)::int as n from public.stat_events
         where student_id = ${user.id} and source_id = ${view.attempt.id}
      `;

      expect(events?.n).toBe(topics?.n);
    });

    it('повторное применение результата не искажает статистику', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      const questions = await questionsOf(assessmentId);
      const payload = questions
        .map((question) => {
          const answer = answerFor(question, true);
          return answer === null ? null : { question_id: question.id, answer, time_spent_sec: 5 };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      await saveAnswers(sql, user, view.attempt.id, { answers: payload });
      await submitAttempt(sql, user, view.attempt.id, {});
      await drainQueue(user.id);

      const before = await sql<{ n: number }[]>`
        select count(*)::int as n from public.stat_events
         where student_id = ${user.id} and source_id = ${view.attempt.id}
      `;
      const masteryBefore = await sql<{ topic_id: string; mastery_pct: string }[]>`
        select topic_id, mastery_pct from public.student_topic_mastery
         where student_id = ${user.id} order by topic_id
      `;

      await sql`
        update public.ai_jobs
           set status = 'queued', applied_at = null, locked_by = null, locked_at = null,
               result = null, finished_at = null
         where student_id = ${user.id}
           and op_type in ('diagnostic_analysis','free_text_grading')
      `;

      await drainQueue(user.id);

      const after = await sql<{ n: number }[]>`
        select count(*)::int as n from public.stat_events
         where student_id = ${user.id} and source_id = ${view.attempt.id}
      `;
      const masteryAfter = await sql<{ topic_id: string; mastery_pct: string }[]>`
        select topic_id, mastery_pct from public.student_topic_mastery
         where student_id = ${user.id} order by topic_id
      `;

      expect(after[0]?.n).toBe(before[0]?.n);
      expect(masteryAfter).toEqual(masteryBefore);
    });
  });

  describe('правила прохождения', () => {
    it('автосохранение после отправки запрещено', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      const questions = await questionsOf(assessmentId);
      const [first] = questions;
      if (first === undefined) {
        throw new Error('в диагностике нет вопросов');
      }

      await submitAttempt(sql, user, view.attempt.id, {});

      const answer = answerFor(first, true);
      await expect(
        saveAnswers(sql, user, view.attempt.id, {
          answers: [{ question_id: first.id, answer: answer ?? { text: 'x' }, time_spent_sec: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'ATTEMPT_ALREADY_SUBMITTED' });
    });

    it('ответ на чужой вопрос отклоняется', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      const [alien] = await sql<{ id: string }[]>`
        select q.id from public.questions q
         where q.is_active and q.id not in (
           select question_id from public.assessment_questions where assessment_id = ${assessmentId}
         )
         limit 1
      `;

      if (alien !== undefined) {
        await expect(
          saveAnswers(sql, user, view.attempt.id, {
            answers: [{ question_id: alien.id, answer: { selected: ['a'] }, time_spent_sec: 1 }],
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      }
    });

    it('диагностика проходится один раз', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      await submitAttempt(sql, user, view.attempt.id, {});

      await expect(
        startAttempt(sql, user, { assessment_id: assessmentId, client_attempt_id: null }, 'test'),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    });

    it('брошенная попытка не закрывает диагностику навсегда', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      await abandonAttempt(sql, user, view.attempt.id, 'test-request');

      const restarted = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      expect(restarted.attempt.id).not.toBe(view.attempt.id);
    });

    it('чужая попытка неотличима от несуществующей', async () => {
      const owner = await newStudentWithDiagnostic();
      const stranger = await createTestUser(sql, 'student', { grade: 11 });
      createdIds.push(stranger.id);

      const view = await startAttempt(
        sql,
        owner.user,
        { assessment_id: owner.assessmentId, client_attempt_id: null },
        'test-request',
      );

      await expect(getAttempt(sql, asAuth(stranger.id), view.attempt.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('результат недоступен, пока попытка не отправлена', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      await expect(getAttemptResult(sql, user, view.attempt.id)).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
    });
  });

  describe('сторож дедлайнов', () => {
    it('отправляет попытку с истёкшим временем, если на неё есть хоть один ответ', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      const questions = await questionsOf(assessmentId);
      const first = questions[0];
      if (first === undefined) throw new Error('в диагностике нет вопросов');
      const answer = answerFor(first, true);
      if (answer === null) throw new Error('не удалось построить ответ');

      await saveAnswers(sql, user, view.attempt.id, {
        answers: [{ question_id: first.id, answer, time_spent_sec: 10 }],
      });

      await sql`
        update public.attempts set deadline_at = now() - interval '1 minute'
         where id = ${view.attempt.id}
      `;

      const report = await runMaintenance(sql, app.log);
      expect(report.autoSubmitted).toBeGreaterThan(0);

      const after = await getAttempt(sql, user, view.attempt.id);
      expect(after.attempt.status).not.toBe('in_progress');

      const [audit] = await sql<{ action: string; actor_id: string | null }[]>`
        select action, actor_id from public.audit_log
         where entity_id = ${view.attempt.id} and action = 'attempt.autosubmit'
      `;

      expect(audit?.action).toBe('attempt.autosubmit');
      expect(audit?.actor_id).toBeNull();
    });

    it('бросает попытку с истёкшим временем без единого ответа, не тратя ИИ и не сжигая единственную попытку', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();
      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );

      await sql`
        update public.attempts set deadline_at = now() - interval '1 minute'
         where id = ${view.attempt.id}
      `;

      const report = await runMaintenance(sql, app.log);
      expect(report.autoSubmitted).toBeGreaterThan(0);

      const after = await getAttempt(sql, user, view.attempt.id);
      expect(after.attempt.status).toBe('abandoned');

      const [autosubmitAudit] = await sql<{ action: string }[]>`
        select action from public.audit_log
         where entity_id = ${view.attempt.id} and action = 'attempt.autosubmit'
      `;
      expect(autosubmitAudit).toBeUndefined();

      const [abandonAudit] = await sql<{ action: string; actor_id: string | null }[]>`
        select action, actor_id from public.audit_log
         where entity_id = ${view.attempt.id} and action = 'attempt.autoabandon'
      `;
      expect(abandonAudit?.action).toBe('attempt.autoabandon');
      expect(abandonAudit?.actor_id).toBeNull();

      const retry = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'test-request',
      );
      expect(retry.attempt.id).not.toBe(view.attempt.id);
      expect(retry.attempt.status).toBe('in_progress');
    });
  });

  describe('первичный опрос', () => {
    it('без него диагностика отвечает состоянием, а не ошибкой', async () => {
      const created = await createTestUser(sql, 'student', { grade: 11 });
      createdIds.push(created.id);

      const state = await getDiagnosticState(sql, asAuth(created.id));

      expect(state.state).toBe('not_assigned');
      expect(state.empty_reason).toBe('onboarding_incomplete');
      expect(state.assessment).toBeNull();
    });

    it('вторая активная диагностика невозможна физически', async () => {
      const { user, assessmentId } = await newStudentWithDiagnostic();

      await expect(
        sql`
          insert into public.assessments (kind, title, student_id, grade, total_points, is_active)
          values ('diagnostic', 'Дубликат', ${user.id}, 11, 10, true)
        `,
      ).rejects.toThrow(/assessments_one_diagnostic_idx|duplicate key/iu);

      expect(assessmentId).toBeTypeOf('string');
    });

    it('одновременный онбординг проходит ровно один раз', async () => {
      const created = await createTestUser(sql, 'student', { grade: 11 });
      createdIds.push(created.id);
      const user = asAuth(created.id);

      const request = {
        goal: 'ent' as const,
        exam_code: 'ent',
        grade: 11 as const,
        target_date: null,
        subject_codes: ['math', 'physics'],
        answers: null,
      };

      const outcomes = await Promise.allSettled([
        completeOnboarding(sql, user, request, 'race-a'),
        completeOnboarding(sql, user, request, 'race-b'),
      ]);

      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.assessments
         where student_id = ${user.id} and kind = 'diagnostic' and is_active
      `;
      expect(count?.n).toBe(1);
    });
  });

  describe('очередь', () => {
    it('операция без обработчика не тратит попытки впустую', async () => {
      const created = await createTestUser(sql, 'student', { grade: 11 });
      createdIds.push(created.id);

      const [job] = await sql<{ id: string }[]>`
        insert into public.ai_jobs (
          op_type, requested_by, student_id, dedupe_key, input, input_hash
        ) values (
          'roadmap_plan', ${created.id}, ${created.id},
          ${`no-handler-${Date.now()}`}, '{}'::jsonb, 'hash'
        )
        returning id
      `;

      await drainQueue(created.id);

      const [row] = await sql<{ status: string; attempts: number }[]>`
        select status::text as status, attempts from public.ai_jobs where id = ${job?.id ?? ''}
      `;

      expect(row?.status).toBe('failed');
      expect(row?.attempts).toBe(1);
    });

    it('испорченный вход не уходит в бесконечные повторы', async () => {
      const created = await createTestUser(sql, 'student', { grade: 11 });
      createdIds.push(created.id);

      const [job] = await sql<{ id: string }[]>`
        insert into public.ai_jobs (
          op_type, requested_by, student_id, dedupe_key, input, input_hash
        ) values (
          'attempt_analysis', ${created.id}, ${created.id},
          ${`bad-input-${Date.now()}`}, '{"nope":true}'::jsonb, 'hash'
        )
        returning id
      `;

      await drainQueue(created.id);

      const [row] = await sql<{ status: string; error: { code?: string } | null }[]>`
        select status::text as status, error from public.ai_jobs where id = ${job?.id ?? ''}
      `;

      expect(row?.status).toBe('failed');
      expect(row?.error?.code).toBe('BAD_INPUT');
    });
  });
});

describe('ошибки домена', () => {
  it('несут машиночитаемый код', () => {
    expect(new AppError('ATTEMPT_ALREADY_SUBMITTED').status).toBe(409);
  });
});
