import { z } from 'zod';

import { buildApp } from '../src/app.js';
import { getEnv, loadDotEnv, type Env } from '../src/env.js';

const classListSchema = z.object({ classes: z.array(z.unknown()) });

const DEMO_PASSWORD = 'tlek-demo-2026';
const DEMO_TEACHER_EMAIL = 'demo.teacher@tlek.local';
const DEMO_CLASS_NAME = 'Демо 9 «А»';

async function signIn(env: Env, email: string, password: string): Promise<string | null> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY;

  if (url === undefined || key === undefined) {
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

async function main(): Promise<void> {
  loadDotEnv();
  const env = getEnv();
  const app = await buildApp({ loggerEnabled: false });

  try {
    const domain = env.TEACHER_ORG_DOMAINS[0];
    if (domain === undefined) {
      console.log('! TEACHER_ORG_DOMAINS пуст — заявка останется на рассмотрении');
    }

    const request = await app.inject({
      method: 'POST',
      url: '/v1/auth/teacher-requests',
      payload: {
        email: DEMO_TEACHER_EMAIL,
        display_name: 'Демо Учитель',
        organization_email: `director@${domain ?? 'unknown.example'}`,
        organization_name: 'Демонстрационная школа',
      },
    });
    console.log(`заявка:      ${request.statusCode} ${request.body.slice(0, 120)}`);

    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: DEMO_TEACHER_EMAIL,
        password: DEMO_PASSWORD,
        display_name: 'Демо Учитель',
        role: 'teacher',
      },
    });
    console.log(
      `регистрация: ${registration.statusCode}` +
        (registration.statusCode === 409 ? ' (аккаунт уже был)' : ''),
    );

    const token = await signIn(env, DEMO_TEACHER_EMAIL, DEMO_PASSWORD);
    if (token === null) {
      console.log('\n! Войти демонстрационным учителем не удалось');
      process.exitCode = 1;
      return;
    }

    const headers = { authorization: `Bearer ${token}` };
    const classes = await app.inject({ method: 'GET', url: '/v1/classes', headers });

    const parsed = classListSchema.safeParse(
      classes.statusCode === 200 ? (JSON.parse(classes.body) as unknown) : null,
    );
    const hasClasses = parsed.success && parsed.data.classes.length > 0;

    if (!hasClasses) {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/classes',

        headers: { ...headers, 'idempotency-key': 'demo-teacher-class' },
        payload: { name: DEMO_CLASS_NAME, grade: 9 },
      });
      console.log(
        `класс:       ${created.statusCode} «${DEMO_CLASS_NAME}»` +
          (created.statusCode >= 400 ? ` ${created.body.slice(0, 200)}` : ''),
      );
    } else {
      console.log('класс:       уже есть');
    }

    console.log('\nВход в приложении:');
    console.log(`  ${DEMO_TEACHER_EMAIL} / ${DEMO_PASSWORD}`);
    console.log('\nЧтобы добавить ученика, возьмите его код (TLK-…) из профиля ученика.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
