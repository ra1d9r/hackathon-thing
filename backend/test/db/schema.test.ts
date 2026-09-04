import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '../../src/db/sql.js';
import { createTestSql, hasDatabase } from '../helpers/db.js';

let sql: Sql;

describe.skipIf(!hasDatabase())('схема базы', () => {
  beforeAll(() => {
    sql = createTestSql();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('RLS включён на каждой таблице схемы public', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
       order by 1
    `;

    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('RLS принудительный — владелец таблиц тоже под политиками', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity
       order by 1
    `;

    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('у таблиц с эталонными ответами и служебных данных нет ни одной политики', async () => {
    const denyAll = [
      'questions',
      'assessment_questions',
      'stat_events',
      'ai_jobs',
      'ai_call_logs',
      'idempotency_keys',
      'rate_limit_counters',
      'audit_log',
      'onboarding_answers',
      'teacher_access_requests',
    ];

    const rows = await sql<{ tablename: string; n: number }[]>`
      select tablename, count(*)::int as n
        from pg_policies
       where schemaname = 'public'
         and tablename = any(${sql.array(denyAll)}::text[])
       group by 1
    `;

    expect(rows).toEqual([]);
  });

  it('каждая таблица имеет первичный ключ', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and not exists (
           select 1 from pg_constraint k
            where k.conrelid = c.oid and k.contype = 'p'
         )
       order by 1
    `;

    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('представления читают данные правами вызывающего, а не владельца', async () => {
    const rows = await sql<{ viewname: string; options: string[] | null }[]>`
      select c.relname as viewname, c.reloptions as options
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
       order by 1
    `;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.options ?? [], row.viewname).toContain('security_invoker=true');
    }
  });

  it('клиенту доступны ровно шесть вспомогательных функций RLS и ничего больше', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and has_function_privilege('authenticated', p.oid, 'execute')
       order by 1
    `;

    expect(rows.map((row) => row.proname)).toEqual([
      'is_channel_member',
      'is_class_member',
      'is_teacher',
      'my_role',
      'owns_class',
      'shares_class_with',
    ]);
  });

  it('роль anon не может вызвать ни одной функции схемы app', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and has_function_privilege('anon', p.oid, 'execute')
       order by 1
    `;

    expect(rows.map((row) => row.proname)).toEqual([]);
  });

  it('у триггерных функций зафиксирован search_path', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and p.prokind = 'f'
         and (p.proconfig is null or not exists (
           select 1 from unnest(p.proconfig) as cfg where cfg like 'search_path=%'
         ))
       order by 1
    `;

    expect(rows.map((row) => row.proname)).toEqual([]);
  });

  it('справочные данные загружены и чертёж ЕНТ сходится на 140 баллах', async () => {
    const [subjects] = await sql<{ n: number }[]>`select count(*)::int as n from public.subjects`;
    const [topics] = await sql<{ n: number }[]>`select count(*)::int as n from public.topics`;
    const [ent] = await sql<{ max_score: string; sections_total: string }[]>`
      select e.max_score, sum(s.max_points) as sections_total
        from public.exam_profiles e
        join public.exam_sections s on s.exam_profile_id = e.id
       where e.code = 'ent'
       group by e.max_score
    `;

    expect(subjects?.n ?? 0).toBeGreaterThanOrEqual(5);
    expect(topics?.n ?? 0).toBeGreaterThanOrEqual(40);
    expect(Number(ent?.max_score)).toBe(140);
    expect(Number(ent?.sections_total)).toBe(140);
  });

  it('банк диагностики и банк пробника не пересекаются', async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n
        from public.questions a
        join public.questions b on a.prompt_md = b.prompt_md and a.id <> b.id
       where a.bank_pool = 'diagnostic' and b.bank_pool = 'exam_mock'
    `;

    expect(row?.n).toBe(0);
  });

  it('у каждого вопроса со свободным ответом есть критерии оценивания', async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n
        from public.questions
       where kind = 'free_text' and (rubric_md is null or rubric_md = '')
    `;

    expect(row?.n).toBe(0);
  });
});
