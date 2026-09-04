import type { Sql } from '../../src/db/sql.js';
import { createSqlClient } from '../../src/db/sql.js';
import { parseEnv } from '../../src/env.js';

export const TEST_EMAIL_PREFIX = 'tlek-test-';

export function hasDatabase(): boolean {
  const url = process.env['DATABASE_URL'];
  return url !== undefined && url.trim() !== '';
}

export function createTestSql(): Sql {
  return createSqlClient(parseEnv(process.env), {
    maxConnections: 2,
    statementTimeoutMs: 20_000,
  });
}

export interface TestUser {
  readonly id: string;
  readonly publicId: string;
  readonly role: 'student' | 'teacher';
}

export async function createTestUser(
  sql: Sql,
  role: 'student' | 'teacher',
  options: { readonly grade?: number; readonly name?: string } = {},
): Promise<TestUser> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `${TEST_EMAIL_PREFIX}${suffix}@example.test`;
  const grade = options.grade ?? (role === 'student' ? 11 : null);
  const name = options.name ?? `Тест ${suffix}`;

  const [authUser] = await sql<{ id: string }[]>`
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', ${email}, '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb
    )
    returning id
  `;

  if (authUser === undefined) {
    throw new Error('не удалось создать пользователя auth.users');
  }

  const [profile] = await sql<{ id: string; public_id: string }[]>`
    insert into public.profiles (id, role, public_id, display_name, grade)
    values (
      ${authUser.id},
      ${role}::public.user_role,
      app.generate_public_id(),
      ${name},
      ${grade}
    )
    returning id, public_id
  `;

  if (profile === undefined) {
    throw new Error('не удалось создать профиль');
  }

  return { id: profile.id, publicId: profile.public_id, role };
}

export async function asUser<T>(
  sql: Sql,
  userId: string,
  handler: (tx: Sql) => Promise<T>,
): Promise<T> {
  const reserved = await sql.reserve();
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });

  try {
    await reserved.unsafe('begin');
    await reserved.unsafe('set local role authenticated');
    await reserved.unsafe(`set local request.jwt.claims = '${claims}'`);

    try {
      return await handler(reserved);
    } finally {
      await reserved.unsafe('rollback').catch(() => undefined);
    }
  } finally {
    reserved.release();
  }
}

export async function cleanupTestUsers(sql: Sql, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await sql`delete from auth.users where id = any(${[...ids]}::uuid[])`;
}

export async function topicIdByCode(sql: Sql, code: string): Promise<{ topicId: string; subjectId: string }> {
  const [row] = await sql<{ id: string; subject_id: string }[]>`
    select id, subject_id from public.topics where code = ${code}
  `;
  if (row === undefined) {
    throw new Error(`тема ${code} не найдена — загрузите справочные данные`);
  }
  return { topicId: row.id, subjectId: row.subject_id };
}
