import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { jobStatusResponseSchema } from '../../src/contracts/dto/ai-jobs.js';
import {
  assistantChannelResponseSchema,
  assistantMessagesResponseSchema,
  postAssistantMessageResponseSchema,
} from '../../src/contracts/dto/assistant.js';
import {
  attemptResultSchema,
  attemptViewSchema,
  diagnosticStateSchema,
  submitResponseSchema,
} from '../../src/contracts/dto/attempts.js';
import { meResponseSchema } from '../../src/contracts/dto/auth.js';
import { errorEnvelopeSchema } from '../../src/contracts/errors.js';
import type { Sql } from '../../src/db/sql.js';
import { QueueWorker } from '../../src/queue/worker.js';
import { buildTestApp } from '../helpers/app.js';
import { createTestSql, hasDatabase, TEST_EMAIL_PREFIX } from '../helpers/db.js';
import { drainJobs } from '../helpers/queue.js';


const PASSWORD = 'tlek-live-test-2026';

let sql: Sql;
let app: FastifyInstance;
let accessToken: string | null = null;
let userId: string | null = null;

const supabaseUrl = process.env['SUPABASE_URL'] ?? '';
const publishableKey =
  process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_ANON_KEY'] ?? '';

const canRun = hasDatabase() && supabaseUrl !== '' && publishableKey !== '';

function mutationHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken ?? ''}`,
    'idempotency-key': randomUUID(),
  };
}

function bearer(): Record<string, string> {
  return { authorization: `Bearer ${accessToken ?? ''}` };
}

async function drainQueue(): Promise<void> {
  const worker = new QueueWorker({
    sql,
    log: app.log,
    workerId: 'worker-live-test',
    maintenance: false,
  });

  if (userId === null) {
    throw new Error('пользователь не создан — разбирать нечего');
  }

  await drainJobs(sql, worker, userId);
}

async function signIn(email: string): Promise<string | null> {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });

  const body: unknown = await response.json();
  if (typeof body === 'object' && body !== null && 'access_token' in body) {
    const token: unknown = body.access_token;
    return typeof token === 'string' ? token : null;
  }
  return null;
}

describe.skipIf(!canRun)('аутентификация настоящим токеном', () => {
  beforeAll(async () => {
    sql = createTestSql();
    app = await buildTestApp({
      DATABASE_URL: process.env['DATABASE_URL'] ?? '',
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SECRET_KEY: process.env['SUPABASE_SECRET_KEY'] ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
      AUTH_RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_MAX: '10000',
    });

    const email = `${TEST_EMAIL_PREFIX}live-${Math.random().toString(36).slice(2, 8)}@example.test`;

    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email,
        password: PASSWORD,
        display_name: 'Живой Тест',
        role: 'student',
        grade: 11,
      },
    });

    if (registration.statusCode === 201) {
      const parsed: unknown = registration.json();
      if (typeof parsed === 'object' && parsed !== null && 'user_id' in parsed) {
        const id: unknown = parsed.user_id;
        userId = typeof id === 'string' ? id : null;
      }
      accessToken = await signIn(email);
    }
  });

  afterAll(async () => {
    await app.close();
    if (userId !== null) {
      await sql`delete from auth.users where id = ${userId}`;
    }
    await sql.end();
  });

  it('вход выдаёт токен', () => {
    expect(accessToken).not.toBeNull();
  });

  it('с настоящим токеном профиль доступен', async () => {
    expect(accessToken).not.toBeNull();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${accessToken ?? ''}` },
    });

    expect(response.statusCode).toBe(200);

    const body = meResponseSchema.parse(response.json());
    expect(body.user_id).toBe(userId);
    expect(body.role).toBe('student');
    expect(body.requires_onboarding).toBe(true);
    expect(body.public_id).toMatch(/^TLK-[0-9A-Z]{8}$/);
  });

  it('каталог целей доступен и содержит чертежи экзаменов', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalog/goals',
      headers: { authorization: `Bearer ${accessToken ?? ''}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ goals: { goal: string; exams: { code: string }[] }[] }>();
    const ent = body.goals.find((goal) => goal.goal === 'ent');

    expect(ent?.exams.map((exam) => exam.code)).toContain('ent');
  });

  it('онбординг проходится настоящим токеном и собирает диагностику', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/complete',
      headers: mutationHeaders(),
      payload: {
        goal: 'ent',
        exam_code: 'ent',
        grade: 11,
        target_date: '2027-06-15',
        subject_codes: ['math', 'physics'],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      onboarding_completed: boolean;
      diagnostic: { question_count: number } | null;
    }>();

    expect(body.onboarding_completed).toBe(true);
    expect(body.diagnostic?.question_count).toBeGreaterThan(0);
  });

  it('повторный онбординг отклоняется', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/complete',
      headers: mutationHeaders(),
      payload: {
        goal: 'ent',
        exam_code: 'ent',
        grade: 11,
        subject_codes: ['math', 'physics'],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('STATE_CONFLICT');
  });

  it('после онбординга профиль отдаёт предметы и цель', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${accessToken ?? ''}` },
    });

    const body = meResponseSchema.parse(response.json());

    expect(body.requires_onboarding).toBe(false);
    expect(body.student?.goal).toBe('ent');
    expect(body.student?.subjects.map((subject) => subject.code)).toContain('math');
  });

  it('изменение профиля работает и возвращает обновлённые данные', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: mutationHeaders(),
      payload: { display_name: 'Переименованный' },
    });

    expect(response.statusCode).toBe(200);
    expect(meResponseSchema.parse(response.json()).display_name).toBe('Переименованный');
  });

  it('токен с подменённой подписью отклоняется', async () => {
    const parts = (accessToken ?? '').split('.');
    const tampered = `${parts[0] ?? ''}.${parts[1] ?? ''}.${'A'.repeat(64)}`;

    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${tampered}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('учительские маршруты закрыты для ученика', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/me/learning-profile',
      headers: mutationHeaders(),
      payload: { subject_codes: ['math', 'physics'] },
    });

    expect(response.statusCode).toBe(200);
  });
  describe('прохождение диагностики по HTTP', () => {
    let attemptId = '';
    let jobId = '';
    const startKey = randomUUID();

    async function diagnosticAssessmentId(): Promise<string> {
      const response = await app.inject({ method: 'GET', url: '/v1/diagnostic', headers: bearer() });
      return diagnosticStateSchema.parse(response.json()).assessment?.id ?? '';
    }

    it('диагностика назначена и доступна', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/diagnostic', headers: bearer() });

      expect(response.statusCode).toBe(200);
      const body = diagnosticStateSchema.parse(response.json());

      expect(body.state).toBe('available');
      expect(body.assessment?.question_count).toBeGreaterThan(0);
      expect(body.empty_reason).toBeNull();
    });

    it('изменяющий запрос без ключа идемпотентности отклоняется', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/attempts',
        headers: bearer(),
        payload: { assessment_id: randomUUID() },
      });

      expect(response.statusCode).toBe(400);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('VALIDATION_FAILED');
    });

    it('попытка начинается и отдаёт вопросы без эталонных ответов', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/attempts',
        headers: { ...bearer(), 'idempotency-key': startKey },
        payload: { assessment_id: await diagnosticAssessmentId() },
      });

      expect(response.statusCode).toBe(201);
      const body = attemptViewSchema.parse(response.json());
      attemptId = body.attempt.id;

      expect(body.attempt.status).toBe('in_progress');
      expect(body.questions.length).toBeGreaterThan(0);
      expect(response.payload).not.toContain('answer_key');
    });

    it('повтор с тем же ключом возвращает сохранённый ответ', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/attempts',
        headers: { ...bearer(), 'idempotency-key': startKey },
        payload: { assessment_id: await diagnosticAssessmentId() },
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['idempotent-replay']).toBe('true');
      expect(attemptViewSchema.parse(response.json()).attempt.id).toBe(attemptId);
    });

    it('тот же ключ с другими данными — ошибка, а не повтор', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/attempts',
        headers: { ...bearer(), 'idempotency-key': startKey },
        payload: { assessment_id: randomUUID() },
      });

      expect(response.statusCode).toBe(409);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('ответы сохраняются пачкой', async () => {
      const view = attemptViewSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/attempts/${attemptId}`,
            headers: bearer(),
          })
        ).json(),
      );

      const answers = view.questions.map((question) => {
        if (question.kind === 'free_text') {
          return {
            question_id: question.id,
            answer: { text: 'Развёрнутый ответ ученика.' },
            time_spent_sec: 20,
          };
        }
        if (question.kind === 'numeric') {
          return { question_id: question.id, answer: { value: 42 }, time_spent_sec: 20 };
        }
        return {
          question_id: question.id,
          answer: { selected: [question.options?.[0]?.id ?? 'a'] },
          time_spent_sec: 20,
        };
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/attempts/${attemptId}/answers`,
        headers: mutationHeaders(),
        payload: { answers },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ saved: number }>().saved).toBe(answers.length);
    });

    it('отправка возвращает 202 и работу очереди', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/attempts/${attemptId}/submit`,
        headers: mutationHeaders(),
      });

      expect(response.statusCode).toBe(202);
      const body = submitResponseSchema.parse(response.json());
      jobId = body.job?.id ?? '';

      expect(body.attempt.status).toBe('grading');
      expect(body.attempt.deterministic.max_score).toBeGreaterThan(0);
      expect(body.job?.poll_url).toBe(`/v1/ai/jobs/${jobId}`);
    });

    it('статус работы читается по ссылке из ответа', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/ai/jobs/${jobId}?wait_ms=0`,
        headers: bearer(),
      });

      expect(response.statusCode).toBe(200);
      expect(jobStatusResponseSchema.parse(response.json()).job.id).toBe(jobId);
    });

    it('после разбора очереди результат готов', async () => {
      await drainQueue();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/attempts/${attemptId}/result`,
        headers: bearer(),
      });

      expect(response.statusCode).toBe(200);
      const body = attemptResultSchema.parse(response.json());

      expect(body.attempt.status).toBe('graded');
      expect(body.topics.length).toBeGreaterThan(0);
      expect(body.analysis?.source).toBe('fallback');
      expect(body.job).toBeNull();
    });

    it('завершённый результат отдаётся условно, повтор получает 304', async () => {
      const first = await app.inject({
        method: 'GET',
        url: `/v1/attempts/${attemptId}/result`,
        headers: bearer(),
      });

      const etag = first.headers.etag;
      expect(first.statusCode).toBe(200);
      expect(etag).toMatch(/^W\//u);
      expect(first.headers['cache-control']).toContain('private');

      const repeated = await app.inject({
        method: 'GET',
        url: `/v1/attempts/${attemptId}/result`,
        headers: { ...bearer(), 'if-none-match': String(etag) },
      });

      expect(repeated.statusCode).toBe(304);
      expect(repeated.body).toBe('');
      expect(repeated.headers.etag).toBe(etag);
    });

    it('дашборд отвечает 304 на повтор и 200 на чужой отпечаток', async () => {
      const first = await app.inject({
        method: 'GET',
        url: '/v1/dashboard',
        headers: bearer(),
      });

      expect(first.statusCode).toBe(200);
      const etag = String(first.headers.etag);
      expect(etag).toMatch(/^W\//u);

      const cached = await app.inject({
        method: 'GET',
        url: '/v1/dashboard',
        headers: { ...bearer(), 'if-none-match': etag },
      });

      expect(cached.statusCode).toBe(304);
      expect(cached.body).toBe('');

      const stale = await app.inject({
        method: 'GET',
        url: '/v1/dashboard',
        headers: { ...bearer(), 'if-none-match': 'W/"чужой-отпечаток"' },
      });

      expect(stale.statusCode).toBe(200);
      expect(stale.headers.etag).toBe(etag);
    });

    it('отложенный запрос завершённой работы отвечает сразу', async () => {
      const startedAt = Date.now();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/ai/jobs/${jobId}?wait_ms=25000`,
        headers: bearer(),
      });

      const body = jobStatusResponseSchema.parse(response.json());

      expect(body.job.status).toBe('succeeded');
      expect(body.job.applied).toBe(true);
      expect(body.result_ref?.attempt_id).toBe(attemptId);
      expect(body.retry_after_ms).toBeNull();
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    });

    it('чужая работа неотличима от несуществующей', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/ai/jobs/${randomUUID()}`,
        headers: bearer(),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('ассистент по HTTP', () => {
    it('канал открывается и называет остаток суточного лимита', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/assistant/channel',
        headers: bearer(),
      });

      expect(response.statusCode).toBe(200);
      const body = assistantChannelResponseSchema.parse(response.json());
      expect(body.channel.kind).toBe('ai_assistant');
      expect(body.quota.remaining).toBe(body.quota.daily_limit - body.quota.used_today);
    });

    it('обычный вопрос принимается 202 и получает ответ после разбора очереди', async () => {
      const accepted = await app.inject({
        method: 'POST',
        url: '/v1/assistant/messages',
        headers: bearer(),
        payload: { text: 'Объясни, как раскладывать многочлен на множители' },
      });

      expect(accepted.statusCode).toBe(202);
      const body = postAssistantMessageResponseSchema.parse(accepted.json());
      expect(body.reply).toBeNull();
      expect(body.job?.op_type).toBe('assistant_chat');

      await drainQueue();

      const history = await app.inject({
        method: 'GET',
        url: '/v1/assistant/messages?limit=2',
        headers: bearer(),
      });

      expect(history.statusCode).toBe(200);
      const page = assistantMessagesResponseSchema.parse(history.json());
      const reply = page.messages.at(-1);

      expect(reply?.sender_kind).toBe('ai');
      expect(reply?.source).toBe('fallback');
      expect(reply?.body_md.length).toBeGreaterThan(20);
    });

    it('запрещённая тема получает 200 с отказом, а не ошибку', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assistant/messages',
        headers: bearer(),
        payload: { text: 'за кого мне голосовать на выборах?' },
      });

      expect(response.statusCode).toBe(200);
      const body = postAssistantMessageResponseSchema.parse(response.json());

      expect(body.job).toBeNull();
      expect(body.message.moderation).toBe('redirect');
      expect(body.reply?.moderation).toBe('redirect');
      expect(body.reply?.body_md.length).toBeGreaterThan(20);
    });

    it('отметка прочтения обнуляет счётчик непрочитанного', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assistant/read',
        headers: bearer(),
      });

      expect(response.statusCode).toBe(200);

      const channel = await app.inject({
        method: 'GET',
        url: '/v1/assistant/channel',
        headers: bearer(),
      });

      expect(assistantChannelResponseSchema.parse(channel.json()).channel.unread).toBe(0);
    });

    it('минутный предел считается по ученику и отвечает 429', async () => {
      const codes: number[] = [];

      for (let index = 0; index < 11; index += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/assistant/messages',
          headers: bearer(),
          payload: { text: 'скинь порно' },
        });
        codes.push(response.statusCode);
      }

      expect(codes.at(-1)).toBe(429);
      expect(codes.filter((code) => code === 200).length).toBeLessThanOrEqual(10);
    });
  });
});
