import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorEnvelopeSchema } from '../../src/contracts/errors.js';
import { meResponseSchema } from '../../src/contracts/dto/auth.js';
import type { Sql } from '../../src/db/sql.js';
import { buildTestApp } from '../helpers/app.js';
import { createTestSql, hasDatabase, TEST_EMAIL_PREFIX } from '../helpers/db.js';

let app: FastifyInstance;
let sql: Sql;
const createdUserIds: string[] = [];

function uniqueEmail(): string {
  return `${TEST_EMAIL_PREFIX}${Math.random().toString(36).slice(2, 10)}@example.test`;
}

const APPROVED_DOMAIN = 'tlek-test-school.kz';

describe.skipIf(!hasDatabase())('регистрация и профиль', () => {
  beforeAll(async () => {
    sql = createTestSql();
    app = await buildTestApp({
      DATABASE_URL: process.env['DATABASE_URL'] ?? '',
      SUPABASE_URL: process.env['SUPABASE_URL'] ?? '',
      SUPABASE_SECRET_KEY: process.env['SUPABASE_SECRET_KEY'] ?? '',
      SUPABASE_PUBLISHABLE_KEY: process.env['SUPABASE_PUBLISHABLE_KEY'] ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
      TEACHER_ORG_DOMAINS: APPROVED_DOMAIN,
      RATE_LIMIT_MAX: '10000',
      AUTH_RATE_LIMIT_MAX: '10000',
    });
  });

  afterAll(async () => {
    await app.close();
    if (createdUserIds.length > 0) {
      await sql`delete from auth.users where id = any(${createdUserIds}::uuid[])`;
    }
    await sql`delete from public.teacher_access_requests where email like ${`${TEST_EMAIL_PREFIX}%`}`;
    await sql.end();
  });

  async function register(body: Record<string, unknown>) {
    const response = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: body });
    if (response.statusCode === 201) {
      const parsed: unknown = response.json();
      if (typeof parsed === 'object' && parsed !== null && 'user_id' in parsed) {
        const id: unknown = parsed.user_id;
        if (typeof id === 'string') {
          createdUserIds.push(id);
        }
      }
    }
    return response;
  }

  describe('ученик', () => {
    it('регистрируется и получает неизменяемый публичный идентификатор', async () => {
      const response = await register({
        email: uniqueEmail(),
        password: 'очень-надёжный-пароль-1',
        display_name: 'Тестовый Ученик',
        role: 'student',
        grade: 11,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ public_id: string; role: string; requires_onboarding: boolean }>();

      expect(body.role).toBe('student');
      expect(body.public_id).toMatch(/^TLK-[0-9A-Z]{8}$/);
      expect(body.requires_onboarding).toBe(true);
    });

    it('без класса не регистрируется', async () => {
      const response = await register({
        email: uniqueEmail(),
        password: 'очень-надёжный-пароль-1',
        display_name: 'Без класса',
        role: 'student',
      });

      expect(response.statusCode).toBe(400);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('VALIDATION_FAILED');
    });

    it('короткий пароль отклоняется', async () => {
      const response = await register({
        email: uniqueEmail(),
        password: 'корот',
        display_name: 'Слабый пароль',
        role: 'student',
        grade: 9,
      });

      expect(response.statusCode).toBe(400);
    });

    it('повторная регистрация той же почты отклоняется', async () => {
      const email = uniqueEmail();
      const payload = {
        email,
        password: 'очень-надёжный-пароль-1',
        display_name: 'Первый',
        role: 'student',
        grade: 10,
      };

      expect((await register(payload)).statusCode).toBe(201);

      const second = await register(payload);
      expect(second.statusCode).toBe(409);
      expect(errorEnvelopeSchema.parse(second.json()).error.code).toBe('EMAIL_TAKEN');
    });
  });

  describe('учитель', () => {
    it('без заявки зарегистрироваться нельзя', async () => {
      const response = await register({
        email: uniqueEmail(),
        password: 'очень-надёжный-пароль-1',
        display_name: 'Самозванец',
        role: 'teacher',
      });

      expect(response.statusCode).toBe(403);
      const envelope = errorEnvelopeSchema.parse(response.json());
      expect(envelope.error.code).toBe('FORBIDDEN_ROLE');
      expect(envelope.error.details).toMatchObject({ reason: 'request_required' });
    });

    it('заявка с неизвестного домена остаётся на рассмотрении', async () => {
      const email = uniqueEmail();

      const request = await app.inject({
        method: 'POST',
        url: '/v1/auth/teacher-requests',
        payload: {
          email,
          display_name: 'Учитель Ожидающий',
          organization_email: 'director@unknown-school.example',
        },
      });

      expect(request.statusCode).toBe(202);
      expect(request.json<{ status: string; can_register_now: boolean }>()).toMatchObject({
        status: 'pending',
        can_register_now: false,
      });

      const registration = await register({
        email,
        password: 'очень-надёжный-пароль-1',
        display_name: 'Учитель Ожидающий',
        role: 'teacher',
      });

      expect(registration.statusCode).toBe(403);
      expect(errorEnvelopeSchema.parse(registration.json()).error.details).toMatchObject({
        reason: 'request_pending',
      });
    });

    it('заявка с разрешённого домена одобряется и открывает регистрацию', async () => {
      const email = uniqueEmail();

      const request = await app.inject({
        method: 'POST',
        url: '/v1/auth/teacher-requests',
        payload: {
          email,
          display_name: 'Учитель Одобренный',
          organization_email: `director@${APPROVED_DOMAIN}`,
          organization_name: 'Школа №1',
        },
      });

      expect(request.json<{ status: string; can_register_now: boolean }>()).toMatchObject({
        status: 'approved',
        can_register_now: true,
      });

      const registration = await register({
        email,
        password: 'очень-надёжный-пароль-1',
        display_name: 'Учитель Одобренный',
        role: 'teacher',
      });

      expect(registration.statusCode).toBe(201);
      expect(registration.json<{ role: string; requires_onboarding: boolean }>()).toMatchObject({
        role: 'teacher',
        requires_onboarding: false,
      });
    });

    it('одобренная заявка срабатывает один раз', async () => {
      const email = uniqueEmail();

      await app.inject({
        method: 'POST',
        url: '/v1/auth/teacher-requests',
        payload: {
          email,
          display_name: 'Учитель Повторный',
          organization_email: `head@${APPROVED_DOMAIN}`,
        },
      });

      const first = await register({
        email,
        password: 'очень-надёжный-пароль-1',
        display_name: 'Учитель Повторный',
        role: 'teacher',
      });
      expect(first.statusCode).toBe(201);

      const second = await register({
        email: uniqueEmail(),
        password: 'очень-надёжный-пароль-1',
        display_name: 'Чужой',
        role: 'teacher',
      });
      expect(second.statusCode).toBe(403);
    });
  });

  describe('доступ к профилю', () => {
    it('без токена профиль недоступен', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/me' });

      expect(response.statusCode).toBe(401);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('UNAUTHENTICATED');
    });

    it('поддельный токен отклоняется', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.podpis' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('заголовок без схемы Bearer отклоняется', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('схема ответа профиля описана в контракте', () => {
      expect(meResponseSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('неизменяемость личности', () => {
    it('роль в базе изменить нельзя', async () => {
      const [row] = await sql<{ id: string }[]>`
        select id from public.profiles
         where id = any(${createdUserIds}::uuid[]) and role = 'student'
         limit 1
      `;
      expect(row).toBeDefined();

      await expect(
        sql`update public.profiles set role = 'teacher' where id = ${row?.id ?? null}`,
      ).rejects.toThrow(/смена роли не допускается/);
    });

    it('публичный идентификатор изменить нельзя', async () => {
      const [row] = await sql<{ id: string }[]>`
        select id from public.profiles
         where id = any(${createdUserIds}::uuid[])
         limit 1
      `;

      await expect(
        sql`update public.profiles set public_id = 'TLK-HACKED0' where id = ${row?.id ?? null}`,
      ).rejects.toThrow(/public_id неизменяем/);
    });
  });
});
