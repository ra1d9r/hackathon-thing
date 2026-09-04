import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '../../src/db/sql.js';
import { getMessages, listChannels, markRead, postMessage } from '../../src/modules/chat/service.js';
import {
  addMember,
  createClass,
  getClasses,
  getMembers,
  patchClass,
  removeMember,
} from '../../src/modules/classes/service.js';
import {
  createDistribution,
  getInbox,
  listDistributions,
  markSeen,
} from '../../src/modules/distributions/service.js';
import { createMaterial, listMaterials, patchMaterial } from '../../src/modules/materials/service.js';
import type { AuthUser } from '../../src/types/fastify.js';
import { buildTestApp } from '../helpers/app.js';
import { cleanupTestUsers, createTestSql, createTestUser, hasDatabase } from '../helpers/db.js';

let sql: Sql;
let app: FastifyInstance;
const createdIds: string[] = [];

function asTeacher(id: string): AuthUser {
  return { id, role: 'teacher', publicId: 'TLK-TEACHER0' };
}

function asStudent(id: string): AuthUser {
  return { id, role: 'student', publicId: 'TLK-STUDENT0' };
}

async function newTeacher(): Promise<AuthUser> {
  const created = await createTestUser(sql, 'teacher');
  createdIds.push(created.id);
  return asTeacher(created.id);
}

async function newStudent(): Promise<{ user: AuthUser; publicId: string }> {
  const created = await createTestUser(sql, 'student', { grade: 11 });
  createdIds.push(created.id);
  return { user: asStudent(created.id), publicId: created.publicId };
}

async function classWithStudent(): Promise<{
  teacher: AuthUser;
  student: AuthUser;
  classId: string;
  channelId: string;
}> {
  const teacher = await newTeacher();
  const { user: student, publicId } = await newStudent();

  const created = await createClass(sql, teacher, { name: 'Физика 11А', grade: 11 }, 'test');
  await addMember(sql, teacher, created.class.id, { public_id: publicId }, 'test');

  const refreshed = await getClasses(sql, teacher);
  const view = refreshed.classes.find((item) => item.id === created.class.id);

  if (view?.chat_channel_id == null) {
    throw new Error('канал чата класса не создан');
  }

  return { teacher, student, classId: created.class.id, channelId: view.chat_channel_id };
}

async function textMaterial(teacher: AuthUser, classId: string, title = 'Абылай хан'): Promise<string> {
  const material = await createMaterial(
    sql,

    null,
    teacher,
    {
      format: 'markdown',
      title,
      body_md: '# Заголовок\n**жирный** текст\n- пункт',
      class_id: classId,
    },
    'test',
  );
  return material.material.id;
}

beforeAll(async () => {
  if (!hasDatabase()) {
    return;
  }
  sql = createTestSql();
  app = await buildTestApp();
});

afterAll(async () => {
  if (!hasDatabase()) {
    return;
  }
  await cleanupTestUsers(sql, createdIds);
  await app.close();
  await sql.end({ timeout: 5 });
});

describe.skipIf(!hasDatabase())('учительская часть', () => {
  it('класс создаётся вместе с каналом чата, учитель в нём участник', async () => {
    const teacher = await newTeacher();

    const created = await createClass(sql, teacher, { name: 'Химия 10Б', grade: 10 }, 'test');

    expect(created.class.name).toBe('Химия 10Б');
    expect(created.class.member_count).toBe(0);
    expect(created.class.chat_channel_id).not.toBeNull();

    const channels = await listChannels(sql, teacher);
    expect(channels.channels.map((channel) => channel.id)).toContain(
      created.class.chat_channel_id,
    );
  });

  it('ученик добавляется по коду и попадает и в класс, и в чат', async () => {
    const { teacher, student, classId, channelId } = await classWithStudent();

    const members = await getMembers(sql, teacher, classId);
    expect(members.members).toHaveLength(1);
    expect(members.members[0]?.student_id).toBe(student.id);
    expect(members.class.member_count).toBe(1);

    const channels = await listChannels(sql, student);
    expect(channels.channels.map((channel) => channel.id)).toContain(channelId);
  });

  it('код в нижнем регистре тоже работает', async () => {
    const teacher = await newTeacher();
    const { publicId } = await newStudent();
    const created = await createClass(sql, teacher, { name: 'Класс' }, 'test');

    const added = await addMember(
      sql,
      teacher,
      created.class.id,
      { public_id: publicId.toLowerCase() },
      'test',
    );

    expect(added.student.public_id).toBe(publicId);
  });

  it('неизвестный код и код учителя дают один и тот же отказ', async () => {
    const teacher = await newTeacher();
    const other = await newTeacher();
    const created = await createClass(sql, teacher, { name: 'Класс' }, 'test');

    const [otherProfile] = await sql<{ public_id: string }[]>`
      select public_id from public.profiles where id = ${other.id}
    `;

    const unknown = await addMember(sql, teacher, created.class.id, { public_id: 'TLK-00000000' }, 'x')
      .then(() => null)
      .catch((error: unknown) => error);
    const teacherCode = await addMember(
      sql,
      teacher,
      created.class.id,
      { public_id: otherProfile?.public_id ?? 'TLK-00000000' },
      'x',
    )
      .then(() => null)
      .catch((error: unknown) => error);

    expect(unknown).toMatchObject({ code: 'NOT_FOUND' });
    expect(teacherCode).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('повторное добавление отклоняется, исключение возвращает в прежнюю строку', async () => {
    const teacher = await newTeacher();
    const { user: student, publicId } = await newStudent();
    const created = await createClass(sql, teacher, { name: 'Класс' }, 'test');

    await addMember(sql, teacher, created.class.id, { public_id: publicId }, 'test');
    await expect(
      addMember(sql, teacher, created.class.id, { public_id: publicId }, 'test'),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const removed = await removeMember(sql, teacher, created.class.id, student.id, 'test');
    expect(removed.removed).toBe(true);
    expect(removed.member_count).toBe(0);

    const channels = await listChannels(sql, student);
    expect(channels.channels.map((channel) => channel.class_id)).not.toContain(created.class.id);

    await addMember(sql, teacher, created.class.id, { public_id: publicId }, 'test');
    const [rows] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.class_members
       where class_id = ${created.class.id} and student_id = ${student.id}
    `;
    expect(rows?.n).toBe(1);
  });

  it('чужой класс неотличим от несуществующего', async () => {
    const { classId } = await classWithStudent();
    const stranger = await newTeacher();

    await expect(getMembers(sql, stranger, classId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      patchClass(sql, stranger, classId, { name: 'Чужой' }, 'test'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getMembers(sql, stranger, randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('ученику учительские действия недоступны', async () => {
    const { student, classId } = await classWithStudent();

    await expect(createClass(sql, student, { name: 'Мой класс' }, 'test')).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
    await expect(getMembers(sql, student, classId)).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
  });

  it('материал с разметкой очищается и отдаётся деревом', async () => {
    const { teacher, classId } = await classWithStudent();

    const created = await createMaterial(
      sql,
      null,
      teacher,
      {
        format: 'markdown',
        title: 'Абылай хан',
        body_md: '<script>alert(1)</script>\n# Заголовок\n**жирный** текст',
        class_id: classId,
      },
      'test',
    );

    expect(created.material.body_md).not.toContain('<script>');
    expect(created.material.body_md).toContain('alert(1)');
    expect(created.material.body_blocks?.some((block) => block.type === 'heading')).toBe(true);
    expect(created.material.content_hash).toMatch(/^sha256:/u);
    expect(created.material.est_read_minutes).toBeGreaterThan(0);
  });

  it('ссылка во внутреннюю сеть не сохраняется', async () => {
    const { teacher, classId } = await classWithStudent();

    await expect(
      createMaterial(
        sql,
        null,
        teacher,
        {
          format: 'link',
          title: 'Видео',
          external_url: 'http://169.254.169.254/latest/meta-data/',
          class_id: classId,
        },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('правка текста меняет отпечаток, правка заголовка — нет', async () => {
    const { teacher, classId } = await classWithStudent();
    const materialId = await textMaterial(teacher, classId);

    const [before] = (await listMaterials(sql, teacher, {})).materials.filter(
      (item) => item.id === materialId,
    );

    const renamed = await patchMaterial(sql, teacher, materialId, { title: 'Новое имя' }, 'test');
    expect(renamed.material.content_hash).toBe(before?.content_hash);

    const rewritten = await patchMaterial(
      sql,
      teacher,
      materialId,
      { body_md: '# Совсем другой текст' },
      'test',
    );

    expect(rewritten.material.content_hash).not.toBe(before?.content_hash);
  });

  it('рассылка доходит до входящих ученика и отмечается просмотренной', async () => {
    const { teacher, student, classId } = await classWithStudent();
    const materialId = await textMaterial(teacher, classId, 'Урок для класса');

    const sent = await createDistribution(
      sql,
      teacher,
      { material_id: materialId, class_id: classId, message_md: 'Прочитать к пятнице' },
      'test',
    );

    expect(sent.distribution.recipient_count).toBe(1);
    expect(sent.distribution.seen_count).toBe(0);

    const inbox = await getInbox(sql, student, {});
    expect(inbox.items).toHaveLength(1);
    expect(inbox.unread).toBe(1);

    const item = inbox.items[0];
    expect(item?.material.title).toBe('Урок для класса');

    expect(item?.material.body_blocks?.length).toBeGreaterThan(0);
    expect(item?.message_md).toBe('Прочитать к пятнице');
    expect(item?.seen_at).toBeNull();

    const seen = await markSeen(sql, student, sent.distribution.id, true);
    expect(seen.unread).toBe(0);
    expect(seen.opened_at).not.toBeNull();

    const after = await listDistributions(sql, teacher, {});
    expect(after.distributions[0]?.seen_count).toBe(1);
  });

  it('отметка просмотра не двигается при повторе', async () => {
    const { teacher, student, classId } = await classWithStudent();
    const materialId = await textMaterial(teacher, classId);
    const sent = await createDistribution(
      sql,
      teacher,
      { material_id: materialId, class_id: classId },
      'test',
    );

    const first = await markSeen(sql, student, sent.distribution.id, false);
    const second = await markSeen(sql, student, sent.distribution.id, false);

    expect(second.seen_at).toBe(first.seen_at);
  });

  it('чужая рассылка неотличима от несуществующей', async () => {
    const { teacher, classId } = await classWithStudent();
    const outsider = await newStudent();
    const materialId = await textMaterial(teacher, classId);
    const sent = await createDistribution(
      sql,
      teacher,
      { material_id: materialId, class_id: classId },
      'test',
    );

    await expect(markSeen(sql, outsider.user, sent.distribution.id, false)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await getInbox(sql, outsider.user, {})).items).toHaveLength(0);
  });

  it('ученику вне своих классов отправить нельзя', async () => {
    const { teacher, classId } = await classWithStudent();
    const outsider = await newStudent();
    const materialId = await textMaterial(teacher, classId);

    await expect(
      createDistribution(sql, teacher, { material_id: materialId, student_id: outsider.user.id }, 'x'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('чат класса отделён от рассылки', async () => {
    const { teacher, student, classId, channelId } = await classWithStudent();
    const materialId = await textMaterial(teacher, classId);
    await createDistribution(sql, teacher, { material_id: materialId, class_id: classId }, 'test');

    const chat = await getMessages(sql, student, channelId, {});
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]?.sender_kind).toBe('system');
    expect(chat.messages[0]?.body_md).toContain('Новый материал');

    await postMessage(sql, student, channelId, {
      text: 'А что именно читать?',
      client_msg_id: randomUUID(),
    });

    const inbox = await getInbox(sql, student, {});
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.material.id).toBe(materialId);
  });

  it('сообщение в чате видно обоим, повтор не создаёт второго', async () => {
    const { teacher, student, channelId } = await classWithStudent();
    const clientMsgId = randomUUID();

    const first = await postMessage(sql, student, channelId, {
      text: 'Здравствуйте! **Не понял** задание.',
      client_msg_id: clientMsgId,
    });
    const repeated = await postMessage(sql, student, channelId, {
      text: 'Здравствуйте! **Не понял** задание.',
      client_msg_id: clientMsgId,
    });

    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(repeated.message.id).toBe(first.message.id);

    const seen = await getMessages(sql, teacher, channelId, {});
    expect(seen.messages).toHaveLength(1);
    expect(seen.messages[0]?.sender?.id).toBe(student.id);
    expect(seen.messages[0]?.sender?.role).toBe('student');
    expect(JSON.stringify(seen.messages[0]?.body_blocks)).toContain('bold');
  });

  it('отклонённое сообщение в канал не попадает вовсе', async () => {
    const { teacher, student, channelId } = await classWithStudent();

    await expect(
      postMessage(sql, student, channelId, { text: 'скинь порно', client_msg_id: randomUUID() }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const seen = await getMessages(sql, teacher, channelId, {});
    expect(seen.messages).toHaveLength(0);
  });

  it('в канал ассистента через чат класса не пишут', async () => {
    const { student } = await classWithStudent();

    const [channel] = await sql<{ id: string }[]>`
      insert into public.chat_channels (kind, owner_id, title)
      values ('ai_assistant', ${student.id}, 'ИИ-ассистент')
      on conflict do nothing
      returning id
    `;
    const channelId = channel?.id ?? '';
    await sql`
      insert into public.chat_channel_members (channel_id, user_id)
      values (${channelId}, ${student.id}) on conflict do nothing
    `;

    await expect(
      postMessage(sql, student, channelId, { text: 'привет', client_msg_id: randomUUID() }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('чужой канал неотличим от несуществующего', async () => {
    const { channelId } = await classWithStudent();
    const outsider = await newStudent();

    await expect(getMessages(sql, outsider.user, channelId, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      postMessage(sql, outsider.user, channelId, { text: 'привет', client_msg_id: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('непрочитанное считается и сбрасывается отметкой', async () => {
    const { teacher, student, channelId } = await classWithStudent();

    await postMessage(sql, student, channelId, {
      text: 'Вопрос по домашнему заданию',
      client_msg_id: randomUUID(),
    });

    const before = await listChannels(sql, teacher);
    const channel = before.channels.find((item) => item.id === channelId);
    expect(channel?.unread).toBe(1);
    expect(channel?.last_message_preview).toContain('Вопрос');

    const read = await markRead(sql, teacher, channelId);
    expect(read.unread).toBe(0);

    const own = await listChannels(sql, student);
    expect(own.channels.find((item) => item.id === channelId)?.unread).toBe(0);
  });
});
