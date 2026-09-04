import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '../../src/db/sql.js';
import {
  asUser,
  cleanupTestUsers,
  createTestSql,
  createTestUser,
  hasDatabase,
  topicIdByCode,
  type TestUser,
} from '../helpers/db.js';

let sql: Sql;
let alice: TestUser;
let bob: TestUser;
let teacher: TestUser;
const createdIds: string[] = [];

describe.skipIf(!hasDatabase())('политики доступа', () => {
  beforeAll(async () => {
    sql = createTestSql();

    alice = await createTestUser(sql, 'student', { name: 'Алиса' });
    bob = await createTestUser(sql, 'student', { name: 'Боб' });
    teacher = await createTestUser(sql, 'teacher', { name: 'Учитель' });
    createdIds.push(alice.id, bob.id, teacher.id);

    const { topicId, subjectId } = await topicIdByCode(sql, 'math.trigonometry');
    for (const student of [alice, bob]) {
      await sql`
        insert into public.stat_events
          (student_id, topic_id, subject_id, source_type, source_id, delta_pct, baseline_pct, reason)
        values (${student.id}, ${topicId}, ${subjectId}, 'manual', gen_random_uuid(), 20, 30,
                'подготовка теста доступа')
      `;
    }
  });

  afterAll(async () => {
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  it('ученик видит собственное мастерство', async () => {
    const rows = await asUser(sql, alice.id, async (tx) =>
      tx<{ student_id: string }[]>`select student_id from public.student_topic_mastery`,
    );

    expect(rows.length).toBe(1);
    expect(rows[0]?.student_id).toBe(alice.id);
  });

  it('ученик не видит мастерство другого ученика', async () => {
    const rows = await asUser(sql, alice.id, async (tx) =>
      tx<{ student_id: string }[]>`
        select student_id from public.student_topic_mastery where student_id = ${bob.id}
      `,
    );

    expect(rows).toEqual([]);
  });

  it('ученик не видит чужой профиль, пока не связан с ним классом', async () => {
    const rows = await asUser(sql, alice.id, async (tx) =>
      tx<{ id: string }[]>`select id from public.profiles where id = ${bob.id}`,
    );

    expect(rows).toEqual([]);
  });

  it('ученик видит собственный профиль', async () => {
    const rows = await asUser(sql, alice.id, async (tx) =>
      tx<{ id: string }[]>`select id from public.profiles where id = ${alice.id}`,
    );

    expect(rows.length).toBe(1);
  });

  it.each([
    ['questions', 'эталонные ответы'],
    ['assessment_questions', 'состав тестов'],
    ['stat_events', 'журнал статистики'],
    ['ai_jobs', 'очередь задач ИИ'],
    ['audit_log', 'журнал аудита'],
    ['idempotency_keys', 'ключи идемпотентности'],
    ['onboarding_answers', 'сырые ответы опросника'],
  ])('таблица %s (%s) недоступна клиенту', async (table) => {
    await expect(
      asUser(sql, alice.id, async (tx) => tx.unsafe(`select 1 from public.${table} limit 1`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it('каталог предметов и тем читается всеми аутентифицированными', async () => {
    const rows = await asUser(sql, alice.id, async (tx) =>
      tx<{ n: number }[]>`select count(*)::int as n from public.subjects`,
    );

    expect(rows[0]?.n).toBeGreaterThanOrEqual(5);
  });

  it('запись клиенту закрыта даже в собственные данные', async () => {
    await expect(
      asUser(sql, alice.id, async (tx) => {
        await tx`
          update public.student_topic_mastery
             set mastery_pct = 100
           where student_id = ${alice.id}
        `;
      }),
    ).rejects.toThrow();
  });

  it('ученик не может выдать себе роль учителя', async () => {
    await expect(
      asUser(sql, alice.id, async (tx) => {
        await tx`update public.profiles set role = 'teacher' where id = ${alice.id}`;
      }),
    ).rejects.toThrow();
  });

  describe('видимость внутри класса', () => {
    let classId: string;

    beforeAll(async () => {
      const [row] = await sql<{ id: string }[]>`
        insert into public.classes (teacher_id, name, grade)
        values (${teacher.id}, 'Тестовый класс', 11)
        returning id
      `;
      if (row === undefined) {
        throw new Error('класс не создан');
      }
      classId = row.id;

      await sql`
        insert into public.class_members (class_id, student_id, added_by)
        values (${classId}, ${alice.id}, ${teacher.id})
      `;
    });

    it('учитель видит состав своего класса', async () => {
      const rows = await asUser(sql, teacher.id, async (tx) =>
        tx<{ student_id: string }[]>`
          select student_id from public.class_members where class_id = ${classId}
        `,
      );

      expect(rows.map((row) => row.student_id)).toEqual([alice.id]);
    });

    it('участники класса видят профили друг друга', async () => {
      const rows = await asUser(sql, alice.id, async (tx) =>
        tx<{ id: string }[]>`select id from public.profiles where id = ${teacher.id}`,
      );

      expect(rows.length).toBe(1);
    });

    it('ученик вне класса профиль учителя не видит', async () => {
      const rows = await asUser(sql, bob.id, async (tx) =>
        tx<{ id: string }[]>`select id from public.profiles where id = ${teacher.id}`,
      );

      expect(rows).toEqual([]);
    });

    it('учитель не получает доступа к статистике своего ученика', async () => {
      const rows = await asUser(sql, teacher.id, async (tx) =>
        tx<{ n: number }[]>`
          select count(*)::int as n
            from public.student_topic_mastery
           where student_id = ${alice.id}
        `,
      );

      expect(rows[0]?.n).toBe(0);
    });
  });

  describe('чат класса', () => {
    let channelId: string;

    beforeAll(async () => {
      const [cls] = await sql<{ id: string }[]>`
        insert into public.classes (teacher_id, name, grade)
        values (${teacher.id}, 'Класс с чатом', 11)
        returning id
      `;
      if (cls === undefined) {
        throw new Error('класс не создан');
      }

      const [channel] = await sql<{ id: string }[]>`
        insert into public.chat_channels (kind, class_id, title)
        values ('class_chat', ${cls.id}, 'Чат класса')
        returning id
      `;
      if (channel === undefined) {
        throw new Error('канал не создан');
      }
      channelId = channel.id;

      await sql`
        insert into public.chat_channel_members (channel_id, user_id)
        values (${channelId}, ${teacher.id}), (${channelId}, ${alice.id})
      `;
      await sql`
        insert into public.chat_messages (channel_id, sender_id, body_md)
        values (${channelId}, ${teacher.id}, 'Здравствуйте, класс')
      `;
    });

    it('участник канала читает сообщения', async () => {
      const rows = await asUser(sql, alice.id, async (tx) =>
        tx<{ body_md: string }[]>`
          select body_md from public.chat_messages where channel_id = ${channelId}
        `,
      );

      expect(rows.length).toBe(1);
    });

    it('посторонний сообщения не видит', async () => {
      const rows = await asUser(sql, bob.id, async (tx) =>
        tx<{ body_md: string }[]>`
          select body_md from public.chat_messages where channel_id = ${channelId}
        `,
      );

      expect(rows).toEqual([]);
    });

    it('отправка сообщения напрямую в базу запрещена — только через API', async () => {
      await expect(
        asUser(sql, alice.id, async (tx) => {
          await tx`
            insert into public.chat_messages (channel_id, sender_id, body_md)
            values (${channelId}, ${alice.id}, 'мимо API')
          `;
        }),
      ).rejects.toThrow();
    });
  });
});
