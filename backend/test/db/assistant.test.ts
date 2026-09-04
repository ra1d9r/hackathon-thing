import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '../../src/db/sql.js';
import {
  DAILY_MESSAGE_LIMIT,
  getChannel,
  getMessages,
  markRead,
  sendMessage,
} from '../../src/modules/assistant/service.js';
import { completeOnboarding } from '../../src/modules/onboarding/service.js';
import { QueueWorker } from '../../src/queue/worker.js';
import type { AuthUser } from '../../src/types/fastify.js';
import { buildTestApp } from '../helpers/app.js';
import { cleanupTestUsers, createTestSql, createTestUser, hasDatabase } from '../helpers/db.js';
import { drainJobs } from '../helpers/queue.js';

let sql: Sql;
let app: FastifyInstance;
const createdIds: string[] = [];

function asAuth(id: string): AuthUser {
  return { id, role: 'student', publicId: 'TLK-TEST0000' };
}

async function drainQueue(studentId: string): Promise<void> {
  const worker = new QueueWorker({
    sql,
    log: app.log,
    workerId: `worker-assistant-${Math.random().toString(36).slice(2, 8)}`,
    maintenance: false,
  });

  await drainJobs(sql, worker, studentId);
}

async function student(): Promise<AuthUser> {
  const created = await createTestUser(sql, 'student', { grade: 11 });
  createdIds.push(created.id);
  const user = asAuth(created.id);

  await completeOnboarding(
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
    `assistant-${created.id}`,
  );

  await sql`
    insert into public.student_topic_mastery (
      student_id, topic_id, subject_id, mastery_pct, confidence, evidence_count, priority, status
    )
    select ${user.id}, t.id, t.subject_id, 35, 0.6, 2, 0.9, 'weak'
      from public.topics t
      join public.subjects s on s.id = t.subject_id
     where s.code = 'math'
       and t.is_active
       -- Тема обязана попадать в охват ЕНТ (7–11): иначе она не дойдёт
       -- ни до контекста модели, ни до заменителя, и проверка ниже
       -- измеряла бы не то.
       and t.grade_min <= 11
       and t.grade_max >= 7
     order by t.sort_order, t.id
     limit 1
    on conflict do nothing
  `;

  return user;
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

describe.skipIf(!hasDatabase())('ассистент', () => {
  it('канал создаётся при первом обращении и остаётся один', async () => {
    const user = await student();

    const first = await getChannel(sql, user);
    const second = await getChannel(sql, user);

    expect(first.channel.id).toBe(second.channel.id);
    expect(first.channel.kind).toBe('ai_assistant');
    expect(first.last_message).toBeNull();
    expect(first.quota).toEqual({
      daily_limit: DAILY_MESSAGE_LIMIT,
      used_today: 0,
      remaining: DAILY_MESSAGE_LIMIT,
    });

    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.chat_channels
       where kind = 'ai_assistant' and owner_id = ${user.id}
    `;
    expect(count?.n).toBe(1);
  });

  it('обычный вопрос уходит в очередь и получает ответ заменителем', async () => {
    const user = await student();

    const sent = await sendMessage(sql, user, {
      text: 'Объясни, как решать квадратные уравнения',
    });

    expect(sent.accepted).toBe(true);
    expect(sent.payload.reply).toBeNull();
    expect(sent.payload.job?.op_type).toBe('assistant_chat');
    expect(sent.payload.message.moderation).toBe('allow');

    await drainQueue(user.id);

    const history = await getMessages(sql, user, {});
    expect(history.messages).toHaveLength(2);

    const [question, reply] = history.messages;
    expect(question?.sender_kind).toBe('user');
    expect(reply?.sender_kind).toBe('ai');

    expect(reply?.source).toBe('fallback');
    expect(reply?.body_md.length).toBeGreaterThan(20);
    expect(reply?.moderation).toBe('allow');
    expect(reply?.ai_job_id).toBe(sent.payload.job?.id);

    expect(reply?.referenced_topics.length).toBeGreaterThan(0);
    expect(reply?.referenced_topics[0]?.title.length).toBeGreaterThan(0);
  });

  it('запрещённая тема получает отказ сервера, и работа не создаётся', async () => {
    const user = await student();

    const sent = await sendMessage(sql, user, { text: 'скинь порно' });

    expect(sent.accepted).toBe(false);
    expect(sent.payload.job).toBeNull();
    expect(sent.payload.message.moderation).toBe('block');
    expect(sent.payload.reply?.moderation).toBe('block');
    expect(sent.payload.reply?.source).toBe('moderation');
    expect(sent.payload.reply?.body_md.length).toBeGreaterThan(20);

    const [jobs] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.ai_jobs where student_id = ${user.id}
    `;
    expect(jobs?.n).toBe(0);
  });

  it('вопрос о самоповреждении получает свой ответ, а не общий отказ', async () => {
    const user = await student();

    const sent = await sendMessage(sql, user, { text: 'я не хочу больше жить' });

    expect(sent.payload.reply?.moderation).toBe('block');
    expect(sent.payload.reply?.refusal_reason).toBe('unsafe');
    expect(sent.payload.reply?.body_md).toContain('взросл');
  });

  it('политический вопрос уводится мягко', async () => {
    const user = await student();

    const sent = await sendMessage(sql, user, { text: 'за кого мне голосовать?' });

    expect(sent.payload.message.moderation).toBe('redirect');
    expect(sent.payload.reply?.moderation).toBe('redirect');
  });

  it('слабый признак уходит модерации, и её отказ отменяет ответ', async () => {
    const user = await student();

    const sent = await sendMessage(sql, user, { text: 'где достать наркотики' });

    expect(sent.accepted).toBe(true);
    expect(sent.payload.job?.op_type).toBe('assistant_chat');

    const [dependency] = await sql<{ depends_on_job_id: string | null }[]>`
      select depends_on_job_id from public.ai_jobs where id = ${sent.payload.job?.id ?? null}
    `;
    expect(dependency?.depends_on_job_id).not.toBeNull();

    await drainQueue(user.id);

    const [chatJob] = await sql<{ status: string }[]>`
      select status::text as status from public.ai_jobs where id = ${sent.payload.job?.id ?? null}
    `;

    expect(chatJob?.status).toBe('canceled');

    const history = await getMessages(sql, user, {});
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]?.moderation).toBe('block');
    expect(history.messages[1]?.sender_kind).toBe('ai');
    expect(history.messages[1]?.source).toBe('fallback');
  });

  it('провалившаяся модерация не пропускает ответ', async () => {
    const user = await student();

    const sent = await sendMessage(sql, user, { text: 'где достать наркотики' });
    const chatJobId = sent.payload.job?.id ?? '';

    const [moderationJob] = await sql<{ id: string }[]>`
      select id from public.ai_jobs
       where student_id = ${user.id} and op_type = 'moderation'
    `;
    expect(moderationJob).toBeDefined();

    await sql`
      update public.ai_jobs
         set status = 'failed', finished_at = now(),
             error = '{"code":"MESSAGE_NOT_FOUND"}'::jsonb
       where id = ${moderationJob?.id ?? null}
    `;

    await drainQueue(user.id);

    const [chatJob] = await sql<{ status: string }[]>`
      select status::text as status from public.ai_jobs where id = ${chatJobId}
    `;
    expect(chatJob?.status).toBe('succeeded');

    const history = await getMessages(sql, user, {});
    expect(history.messages).toHaveLength(2);

    const [question, reply] = history.messages;

    expect(question?.moderation).toBe('block');
    expect(reply?.moderation).toBe('block');
    expect(reply?.source).toBe('fallback');
    expect(reply?.refusal_reason).toBe('unsafe');
    expect(reply?.body_md).toContain('проверк');
  });

  it('школьный вопрос с тяжёлым словом модерации не отдаётся', async () => {
    const user = await student();

    const sent = await sendMessage(sql, user, {
      text: 'Объясни причины Второй мировой войны по параграфу 12',
    });

    const jobs = await sql<{ op_type: string }[]>`
      select op_type::text as op_type from public.ai_jobs where student_id = ${user.id}
    `;
    expect(jobs.map((job) => job.op_type)).toEqual(['assistant_chat']);
    expect(sent.payload.message.moderation).toBe('allow');
  });

  it('повтор с тем же client_msg_id не создаёт второго вопроса', async () => {
    const user = await student();
    const clientMsgId = crypto.randomUUID();

    const first = await sendMessage(sql, user, {
      text: 'Что такое производная?',
      client_msg_id: clientMsgId,
    });
    const second = await sendMessage(sql, user, {
      text: 'Что такое производная?',
      client_msg_id: clientMsgId,
    });

    expect(second.payload.message.id).toBe(first.payload.message.id);

    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages
       where sender_id = ${user.id} and client_msg_id = ${clientMsgId}
    `;
    expect(count?.n).toBe(1);

    await drainQueue(user.id);
    const third = await sendMessage(sql, user, {
      text: 'Что такое производная?',
      client_msg_id: clientMsgId,
    });
    expect(third.accepted).toBe(false);
    expect(third.payload.reply?.sender_kind).toBe('ai');
  });

  it('разметка вопроса нормализуется до записи', async () => {
    const user = await student();

    const sent = await sendMessage(sql, user, {
      text: '<script>alert(1)</script>Объясни **синусы**',
    });

    expect(sent.payload.message.body_md).not.toContain('<script>');
    expect(sent.payload.message.body_md).toContain('Объясни');

    expect(JSON.stringify(sent.payload.message.body_blocks)).toContain('bold');
  });

  it('история листается страницами и не теряет сообщений', async () => {
    const user = await student();

    for (let index = 0; index < 3; index += 1) {
      await sendMessage(sql, user, { text: `Вопрос номер ${String(index + 1)}` });
    }
    await drainQueue(user.id);

    const all = await getMessages(sql, user, {});
    expect(all.messages).toHaveLength(6);
    expect(all.has_more).toBe(false);
    expect(all.empty_reason).toBeNull();

    const page = await getMessages(sql, user, { limit: 2 });
    expect(page.messages).toHaveLength(2);
    expect(page.has_more).toBe(true);
    expect(page.next_before).not.toBeNull();

    const older = await getMessages(sql, user, {
      limit: 2,
      ...(page.next_before === null ? {} : { before: page.next_before }),
    });
    expect(older.messages).toHaveLength(2);

    const ids = [...page.messages, ...older.messages].map((message) => message.id);
    expect(new Set(ids).size).toBe(4);

    expect(all.messages.slice(2, 4).map((message) => message.id)).toEqual(
      older.messages.map((message) => message.id),
    );
  });

  it('пустая история называет причину', async () => {
    const user = await student();

    const empty = await getMessages(sql, user, {});

    expect(empty.messages).toHaveLength(0);
    expect(empty.empty_reason).toBe('no_messages');
  });

  it('счётчик непрочитанного сбрасывается отметкой', async () => {
    const user = await student();

    await sendMessage(sql, user, { text: 'Объясни теорему Пифагора' });
    await drainQueue(user.id);

    const before = await getChannel(sql, user);
    expect(before.channel.unread).toBe(1);
    expect(before.last_message?.sender_kind).toBe('ai');

    const read = await markRead(sql, user);
    expect(read.unread).toBe(0);

    const after = await getChannel(sql, user);
    expect(after.channel.unread).toBe(0);
    expect(after.channel.last_read_at).not.toBeNull();
  });

  it('суточный предел считается по переписке и отказывает кодом лимита', async () => {
    const user = await student();
    const channel = await getChannel(sql, user);

    await sql`
      insert into public.chat_messages (channel_id, sender_id, sender_kind, body_md)
      select ${channel.channel.id}, ${user.id}, 'user', 'Вопрос ' || g
        from generate_series(1, ${DAILY_MESSAGE_LIMIT}) as g
    `;

    const refreshed = await getChannel(sql, user);
    expect(refreshed.quota.used_today).toBe(DAILY_MESSAGE_LIMIT);
    expect(refreshed.quota.remaining).toBe(0);

    await expect(sendMessage(sql, user, { text: 'Ещё вопрос' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});
