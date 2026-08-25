import { randomUUID } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { z } from 'zod';

import { buildApp } from '../src/app.js';
import { getEnv, loadDotEnv, type Env } from '../src/env.js';



const DEMO_PASSWORD = 'tlek-demo-2026';
const DEMO_STUDENT_EMAIL = 'demo.student@tlek.local';
const DEMO_TEACHER_EMAIL = 'demo.teacher@tlek.local';

let failures = 0;

function preview(body: string, limit = 320): string {
  return body.length <= limit ? body : `${body.slice(0, limit)}…`;
}

interface StepRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly payload?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}

async function step(
  app: FastifyInstance,
  title: string,
  request: StepRequest,
  expected: readonly number[],
): Promise<LightMyRequestResponse> {
  const response = await app.inject({
    method: request.method,
    url: request.url,
    ...(request.payload === undefined ? {} : { payload: request.payload }),
    ...(request.headers === undefined ? {} : { headers: request.headers }),
  });

  const ok = expected.includes(response.statusCode);
  if (!ok) {
    failures += 1;
  }

  console.log(`\n${ok ? '✓' : '✗'} ${title}`);
  console.log(
    `  ${request.method} ${request.url} → ${response.statusCode} (ожидалось ${expected.join(' или ')})`,
  );
  console.log(`  ${preview(response.body)}`);
  return response;
}


function mutation(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() };
}


async function signIn(env: Env, email: string, password: string): Promise<string | null> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY;

  if (url === undefined || key === undefined) {
    console.log('\n! SUPABASE_URL или публикуемый ключ не заданы — вход невозможен');
    return null;
  }

  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body: unknown = await response.json();
  if (typeof body === 'object' && body !== null && 'access_token' in body) {
    const token: unknown = body.access_token;
    return typeof token === 'string' ? token : null;
  }
  return null;
}


const diagnosticShape = z.object({
  state: z.string(),
  assessment: z.object({ id: z.string() }).nullable(),
  attempt: z.object({ id: z.string() }).nullable(),
});

const attemptShape = z.object({
  attempt: z.object({ id: z.string() }),
  questions: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      options: z.array(z.object({ id: z.string() })).nullable(),
    }),
  ),
});

const submitShape = z.object({ job: z.object({ id: z.string() }).nullable() });
const jobShape = z.object({ job: z.object({ status: z.string() }) });
const resultShape = z.object({
  attempt: z.object({ status: z.string() }),
  job: z.object({ id: z.string() }).nullable(),
});

function parse<Schema extends z.ZodType>(
  schema: Schema,
  response: LightMyRequestResponse,
): z.infer<Schema> | null {
  const parsed = schema.safeParse(response.json());
  return parsed.success ? parsed.data : null;
}

type AttemptQuestion = z.infer<typeof attemptShape>['questions'][number];


function answerFor(question: AttemptQuestion): Record<string, unknown> {
  if (question.kind === 'free_text') {
    return { text: 'Ответ демонстрационного ученика для проверки моделью.' };
  }
  if (question.kind === 'numeric') {
    return { value: 42 };
  }
  return { selected: [question.options?.[0]?.id ?? 'a'] };
}


async function runStudentScenario(app: FastifyInstance, token: string): Promise<void> {
  console.log('\n─── сценарий ученика ───');

  const auth = { authorization: `Bearer ${token}` };

  await step(app, 'Профиль ученика', { method: 'GET', url: '/v1/me', headers: auth }, [200]);

  await step(
    app,
    'Первичный опрос (повтор отклоняется — это ожидаемо)',
    {
      method: 'POST',
      url: '/v1/onboarding/complete',
      headers: mutation(token),
      payload: {
        goal: 'ent',
        exam_code: 'ent',
        grade: 11,
        target_date: '2027-06-15',
        subject_codes: ['math', 'physics'],
      },
    },
    [200, 409],
  );

  const diagnostic = parse(
    diagnosticShape,
    await step(app, 'Состояние диагностики', { method: 'GET', url: '/v1/diagnostic', headers: auth }, [200]),
  );

  const assessmentId = diagnostic?.assessment?.id;
  if (assessmentId === undefined) {
    console.log('\n! Диагностика не собрана — загрузите наполнение: npm run content');
    return;
  }

  if (diagnostic?.state === 'completed') {
    const attemptId = diagnostic.attempt?.id ?? '';
    await step(
      app,
      'Результат уже пройденной диагностики',
      { method: 'GET', url: `/v1/attempts/${attemptId}/result`, headers: auth },
      [200],
    );
    return;
  }

  const started = parse(
    attemptShape,
    await step(
      app,
      'Старт попытки',
      {
        method: 'POST',
        url: '/v1/attempts',
        headers: mutation(token),
        payload: { assessment_id: assessmentId },
      },
      [201],
    ),
  );

  const attemptId = started?.attempt.id;
  if (attemptId === undefined || started === null) {
    return;
  }

  await step(
    app,
    'Автосохранение ответов',
    {
      method: 'PATCH',
      url: `/v1/attempts/${attemptId}/answers`,
      headers: mutation(token),
      payload: {
        answers: started.questions.map((question) => ({
          question_id: question.id,
          answer: answerFor(question),
          time_spent_sec: 25,
        })),
      },
    },
    [200],
  );

  await step(
    app,
    'Отправка без ключа идемпотентности отклоняется',
    { method: 'POST', url: `/v1/attempts/${attemptId}/submit`, headers: auth },
    [400],
  );

  const submitted = parse(
    submitShape,
    await step(
      app,
      'Отправка попытки',
      { method: 'POST', url: `/v1/attempts/${attemptId}/submit`, headers: mutation(token) },
      [202],
    ),
  );

  
  
  
  if (submitted?.job != null) {
    await waitForJob(app, auth, submitted.job.id);
  }

  const first = parse(
    resultShape,
    await step(
      app,
      'Результат попытки',
      { method: 'GET', url: `/v1/attempts/${attemptId}/result`, headers: auth },
      [200],
    ),
  );

  if (first?.job != null) {
    await waitForJob(app, auth, first.job.id);

    await step(
      app,
      'Результат после завершения разбора',
      { method: 'GET', url: `/v1/attempts/${attemptId}/result`, headers: auth },
      [200],
    );
  }
}


async function waitForJob(
  app: FastifyInstance,
  auth: Record<string, string>,
  jobId: string,
): Promise<void> {
  const terminal = new Set(['succeeded', 'failed', 'canceled', 'dead_letter']);

  for (let round = 0; round < 3; round += 1) {
    const polled = parse(
      jobShape,
      await step(
        app,
        `Ожидание работы ${jobId.slice(0, 8)} (заход ${round + 1})`,
        { method: 'GET', url: `/v1/ai/jobs/${jobId}?wait_ms=10000`, headers: auth },
        [200],
      ),
    );

    if (terminal.has(polled?.job.status ?? '')) {
      return;
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const env = getEnv();
  const withDemo = process.argv.includes('--demo');
  const app = await buildApp({ env, loggerEnabled: false });

  try {
    await step(app, 'Проба живости', { method: 'GET', url: '/v1/health' }, [200]);
    await step(app, 'Версия и требования к клиенту', { method: 'GET', url: '/v1/version' }, [200]);
    await step(app, 'Контракт OpenAPI', { method: 'GET', url: '/v1/openapi.json' }, [200]);
    await step(app, 'Несуществующий маршрут', { method: 'GET', url: '/v1/nope' }, [404]);
    await step(app, 'Профиль без токена закрыт', { method: 'GET', url: '/v1/me' }, [401]);
    await step(app, 'Каталог целей закрыт без токена', { method: 'GET', url: '/v1/catalog/goals' }, [401]);
    await step(
      app,
      'Онбординг закрыт без токена',
      {
        method: 'POST',
        url: '/v1/onboarding/complete',
        payload: { goal: 'ent', exam_code: 'ent', grade: 11, subject_codes: ['math', 'physics'] },
      },
      [401],
    );
    await step(
      app,
      'Профиль с поддельным токеном закрыт',
      { method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer poddelka' } },
      [401],
    );
    await step(
      app,
      'Учителем без заявки зарегистрироваться нельзя',
      {
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'samozvanec@tlek.local',
          password: DEMO_PASSWORD,
          display_name: 'Самозванец',
          role: 'teacher',
        },
      },
      [403],
    );

    if (withDemo) {
      console.log('\n─── демонстрационные аккаунты ───');

      await step(
        app,
        'Регистрация ученика',
        {
          method: 'POST',
          url: '/v1/auth/register',
          payload: {
            email: DEMO_STUDENT_EMAIL,
            password: DEMO_PASSWORD,
            display_name: 'Демо Ученик',
            role: 'student',
            grade: 11,
          },
        },
        [201, 409],
      );

      const domain = env.TEACHER_ORG_DOMAINS[0];
      if (domain === undefined) {
        console.log('\n! TEACHER_ORG_DOMAINS пуст — заявка учителя останется на рассмотрении');
      }

      await step(
        app,
        'Заявка на учительский доступ',
        {
          method: 'POST',
          url: '/v1/auth/teacher-requests',
          payload: {
            email: DEMO_TEACHER_EMAIL,
            display_name: 'Демо Учитель',
            organization_email: `director@${domain ?? 'unknown.example'}`,
            organization_name: 'Демонстрационная школа',
          },
        },
        [202],
      );

      await step(
        app,
        'Регистрация учителя по одобренной заявке',
        {
          method: 'POST',
          url: '/v1/auth/register',
          payload: {
            email: DEMO_TEACHER_EMAIL,
            password: DEMO_PASSWORD,
            display_name: 'Демо Учитель',
            role: 'teacher',
          },
        },
        [201, 403, 409],
      );

      console.log(`\nВойти можно через Supabase Auth:`);
      console.log(`  ученик:  ${DEMO_STUDENT_EMAIL} / ${DEMO_PASSWORD}`);
      console.log(`  учитель: ${DEMO_TEACHER_EMAIL} / ${DEMO_PASSWORD}`);

      const token = await signIn(env, DEMO_STUDENT_EMAIL, DEMO_PASSWORD);
      if (token === null) {
        console.log('\n! Войти демонстрационным учеником не удалось — сценарий пропущен');
        failures += 1;
      } else {
        await runStudentScenario(app, token);
      }
    }
  } finally {
    await app.close();
  }

  console.log(`\nШагов с ошибкой: ${failures}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
