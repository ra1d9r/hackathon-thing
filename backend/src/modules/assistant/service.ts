import type {
  AssistantChannelResponse,
  AssistantMessagesQuery,
  AssistantMessagesResponse,
  AssistantMessageView,
  MarkReadResponse,
  PostAssistantMessageRequest,
  PostAssistantMessageResponse,
} from '../../contracts/dto/assistant.js';
import type { ModerationCategory } from '../../contracts/ai/assistant.js';
import { AppError } from '../../contracts/errors.js';
import type { JsonObject } from '../../contracts/json.js';
import { MARKDOWN_LIMITS, normalizeMarkdown } from '../../contracts/markdown.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import { localDate, resolveTimeZone } from '../../domain/day.js';
import { refusalText, screenMessage, type ScreenResult } from '../../domain/moderation.js';
import { enqueueJob, pollUrl, SUGGESTED_WAIT_MS } from '../../queue/jobs.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  ensureChannel,
  lastMessage,
  loadHistory,
  toMessageViews,
  unreadCount,
  type MessageRow,
} from './queries.js';

const DEFAULT_PAGE_SIZE = 30;

export const DAILY_MESSAGE_LIMIT = 100;

export interface SendOutcome {
  readonly payload: PostAssistantMessageResponse;
  
  readonly accepted: boolean;
}

async function studentTimeZone(sql: SqlExecutor, studentId: string): Promise<string> {
  const [row] = await sql<{ timezone: string | null }[]>`
    select timezone from public.profiles where id = ${studentId}
  `;
  return resolveTimeZone(row?.timezone);
}

async function usedToday(
  sql: SqlExecutor,
  channelId: string,
  timezone: string,
): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from public.chat_messages
     where channel_id = ${channelId}
       and sender_kind = 'user'
       and (created_at at time zone ${timezone})::date = ${localDate(timezone)}::date
  `;
  return row?.n ?? 0;
}

export async function getChannel(sql: Sql, user: AuthUser): Promise<AssistantChannelResponse> {
  const channel = await ensureChannel(sql, user.id);
  const timezone = await studentTimeZone(sql, user.id);

  const [unread, used, last] = await Promise.all([
    unreadCount(sql, channel.id, channel.lastReadAt),
    usedToday(sql, channel.id, timezone),
    lastMessage(sql, channel.id),
  ]);

  const [lastView] = last === null ? [] : await toMessageViews(sql, [last]);

  return {
    channel: {
      id: channel.id,
      kind: 'ai_assistant',
      title: channel.title,
      created_at: channel.createdAt.toISOString(),
      unread,
      last_read_at: channel.lastReadAt?.toISOString() ?? null,
    },
    last_message: lastView ?? null,
    quota: {
      daily_limit: DAILY_MESSAGE_LIMIT,
      used_today: used,
      remaining: Math.max(0, DAILY_MESSAGE_LIMIT - used),
    },
  };
}

export async function getMessages(
  sql: Sql,
  user: AuthUser,
  query: AssistantMessagesQuery,
): Promise<AssistantMessagesResponse> {
  const channel = await ensureChannel(sql, user.id);
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;

  const page = await loadHistory(sql, channel.id, { before: query.before, limit });
  const views = await toMessageViews(sql, page.rows);

  
  
  
  const ordered = [...views].reverse();
  const oldest = page.rows.at(-1);

  return {
    messages: ordered,
    next_before: page.hasMore && oldest !== undefined ? oldest.id : null,
    has_more: page.hasMore,
    empty_reason: ordered.length === 0 && query.before === undefined ? 'no_messages' : null,
  };
}

export async function markRead(sql: Sql, user: AuthUser): Promise<MarkReadResponse> {
  const channel = await ensureChannel(sql, user.id);

  const [row] = await sql<{ last_read_at: Date }[]>`
    update public.chat_channel_members
       set last_read_at = now()
     where channel_id = ${channel.id} and user_id = ${user.id}
    returning last_read_at
  `;

  if (row === undefined) {
    throw new AppError('STATE_CONFLICT', { message: 'Канал ассистента недоступен' });
  }

  return {
    last_read_at: row.last_read_at.toISOString(),
    unread: await unreadCount(sql, channel.id, row.last_read_at),
  };
}

async function replayExisting(
  sql: Sql,
  channelId: string,
  studentId: string,
  clientMsgId: string,
): Promise<SendOutcome | null> {
  const [existing] = await sql<MessageRow[]>`
    select id, sender_kind::text as sender_kind, body_md, moderation::text as moderation,
           client_msg_id, ai_job_id, meta, created_at
      from public.chat_messages
     where channel_id = ${channelId}
       and sender_id = ${studentId}
       and client_msg_id = ${clientMsgId}
  `;

  if (existing === undefined) {
    return null;
  }

  
  
  
  const [reply] = await sql<MessageRow[]>`
    select id, sender_kind::text as sender_kind, body_md, moderation::text as moderation,
           client_msg_id, ai_job_id, meta, created_at
      from public.chat_messages
     where channel_id = ${channelId}
       and sender_kind <> 'user'
       and meta ->> 'in_reply_to' = ${existing.id}
     order by created_at, id
     limit 1
  `;

  const views = await toMessageViews(sql, reply === undefined ? [existing] : [existing, reply]);
  const [messageView, replyView] = views;

  if (messageView === undefined) {
    return null;
  }

  const job = await pendingJobFor(sql, existing.id);

  return {
    payload: { message: messageView, reply: replyView ?? null, job },
    accepted: replyView === undefined,
  };
}

type JobView = PostAssistantMessageResponse['job'];

async function pendingJobFor(sql: SqlExecutor, messageId: string): Promise<JobView> {
  const [row] = await sql<{ id: string; status: string }[]>`
    select id, status::text as status
      from public.ai_jobs
     where op_type = 'assistant_chat'
       and dedupe_key = ${`assistant_chat:${messageId}`}
     order by created_at desc
     limit 1
  `;

  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    op_type: 'assistant_chat',
    status: row.status,
    poll_url: pollUrl(row.id),
    suggested_wait_ms: SUGGESTED_WAIT_MS.assistant_chat,
  };
}

interface InsertedMessage {
  readonly id: string;
  readonly row: MessageRow;
}

async function insertMessage(
  tx: SqlExecutor,
  input: {
    readonly channelId: string;
    readonly senderId: string | null;
    readonly senderKind: 'user' | 'ai' | 'system';
    readonly bodyMd: string;
    readonly moderation: 'allow' | 'block' | 'redirect';
    readonly clientMsgId: string | null;
    readonly aiJobId: string | null;
    readonly meta: JsonObject;
  },
): Promise<InsertedMessage> {
  const [row] = await tx<MessageRow[]>`
    insert into public.chat_messages (
      channel_id, sender_id, sender_kind, body_md, moderation, client_msg_id, ai_job_id, meta
    ) values (
      ${input.channelId},
      ${input.senderId},
      ${input.senderKind}::public.sender_kind,
      ${input.bodyMd},
      ${input.moderation}::public.moderation_verdict,
      ${input.clientMsgId},
      ${input.aiJobId},
      ${tx.json(input.meta)}
    )
    returning id, sender_kind::text as sender_kind, body_md, moderation::text as moderation,
              client_msg_id, ai_job_id, meta, created_at
  `;

  if (row === undefined) {
    throw new Error('сообщение не записано');
  }

  return { id: row.id, row };
}

async function resolveContextHint(
  sql: SqlExecutor,
  hint: PostAssistantMessageRequest['context_hint'],
): Promise<JsonObject> {
  if (hint === undefined) {
    return {};
  }

  const meta: JsonObject = {};

  if (hint.topic_id !== undefined) {
    meta['topic_id'] = hint.topic_id;
  }
  if (hint.lesson_id !== undefined) {
    const [lesson] = await sql<{ topic_id: string }[]>`
      select topic_id from public.lessons where id = ${hint.lesson_id} and is_active
    `;
    meta['lesson_id'] = hint.lesson_id;
    if (lesson !== undefined && meta['topic_id'] === undefined) {
      meta['topic_id'] = lesson.topic_id;
    }
  }

  return meta;
}

function refusalMeta(screen: ScreenResult, inReplyTo: string): JsonObject {
  return {
    source: 'moderation',
    in_reply_to: inReplyTo,
    refusal_reason: screen.category === 'self_harm' ? 'unsafe' : 'off_topic',
    moderation_category: screen.category satisfies ModerationCategory,
    ...(screen.rule === null ? {} : { rule: screen.rule }),
    referenced_topics: [],
    suggested_actions: [],
  };
}

export async function sendMessage(
  sql: Sql,
  user: AuthUser,
  body: PostAssistantMessageRequest,
): Promise<SendOutcome> {
  const channel = await ensureChannel(sql, user.id);
  const clientMsgId = body.client_msg_id ?? null;

  if (clientMsgId !== null) {
    const replayed = await replayExisting(sql, channel.id, user.id, clientMsgId);
    if (replayed !== null) {
      return replayed;
    }
  }

  const timezone = await studentTimeZone(sql, user.id);
  const used = await usedToday(sql, channel.id, timezone);
  if (used >= DAILY_MESSAGE_LIMIT) {
    throw new AppError('RATE_LIMITED', {
      message: `Сегодня можно задать ${String(DAILY_MESSAGE_LIMIT)} вопросов, лимит исчерпан`,
      details: { daily_limit: DAILY_MESSAGE_LIMIT, used_today: used },
    });
  }

  
  
  
  const text = normalizeMarkdown(body.text, { maxLength: MARKDOWN_LIMITS.message });
  if (text === '') {
    throw new AppError('VALIDATION_FAILED', { message: 'Пустой вопрос' });
  }

  const screen = screenMessage(text);
  const hint = await resolveContextHint(sql, body.context_hint);

  const context: SendContext = {
    channelId: channel.id,
    studentId: user.id,
    text,
    clientMsgId,
    screen,
    hint,
  };

  const refuse = screen.decision === 'block' || screen.decision === 'redirect';

  try {
    return refuse ? await refuseImmediately(sql, context) : await queueReply(sql, context);
  } catch (error: unknown) {
    
    
    
    
    if (clientMsgId !== null && isUniqueViolation(error)) {
      const replayed = await replayExisting(sql, channel.id, user.id, clientMsgId);
      if (replayed !== null) {
        return replayed;
      }
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

interface SendContext {
  readonly channelId: string;
  readonly studentId: string;
  readonly text: string;
  readonly clientMsgId: string | null;
  readonly screen: ScreenResult;
  readonly hint: JsonObject;
}

async function refuseImmediately(sql: Sql, context: SendContext): Promise<SendOutcome> {
  const verdict = context.screen.decision === 'block' ? 'block' : 'redirect';

  const { message, reply } = await sql.begin(async (tx) => {
    const question = await insertMessage(tx, {
      channelId: context.channelId,
      senderId: context.studentId,
      senderKind: 'user',
      bodyMd: context.text,
      moderation: verdict,
      clientMsgId: context.clientMsgId,
      aiJobId: null,
      meta: context.hint,
    });

    const answer = await insertMessage(tx, {
      channelId: context.channelId,
      senderId: null,
      senderKind: 'ai',
      bodyMd: refusalText(context.screen.category),
      moderation: verdict,
      clientMsgId: null,
      aiJobId: null,
      meta: refusalMeta(context.screen, question.id),
    });

    return { message: question.row, reply: answer.row };
  });

  const [messageView, replyView] = await toMessageViews(sql, [message, reply]);

  if (messageView === undefined || replyView === undefined) {
    throw new Error('ответ модерации не собрался');
  }

  return {
    payload: { message: messageView, reply: replyView, job: null },
    accepted: false,
  };
}

async function queueReply(sql: Sql, context: SendContext): Promise<SendOutcome> {
  const needsReview = context.screen.decision === 'review';

  const { message, job } = await sql.begin(async (tx) => {
    const question = await insertMessage(tx, {
      channelId: context.channelId,
      senderId: context.studentId,
      senderKind: 'user',
      bodyMd: context.text,
      moderation: 'allow',
      clientMsgId: context.clientMsgId,
      aiJobId: null,
      meta: needsReview
        ? { ...context.hint, screen: 'review', moderation_category: context.screen.category }
        : context.hint,
    });

    const moderation = needsReview
      ? await enqueueJob(tx, {
          opType: 'moderation',
          requestedBy: context.studentId,
          studentId: context.studentId,
          dedupeKey: `moderation:${question.id}`,
          input: {
            student_id: context.studentId,
            message_id: question.id,
            suspected_category: context.screen.category,
          },
          
          
          
          maxAttempts: 2,
        })
      : null;

    const chat = await enqueueJob(tx, {
      opType: 'assistant_chat',
      requestedBy: context.studentId,
      studentId: context.studentId,
      dedupeKey: `assistant_chat:${question.id}`,
      dependsOnJobId: moderation?.id ?? null,
      input: {
        student_id: context.studentId,
        channel_id: context.channelId,
        message_id: question.id,
        ...(typeof context.hint['topic_id'] === 'string'
          ? { topic_id: context.hint['topic_id'] }
          : {}),
      },
      maxAttempts: 3,
    });

    return { message: question.row, job: chat };
  });

  const [messageView] = await toMessageViews(sql, [message]);
  if (messageView === undefined) {
    throw new Error('сообщение не собралось');
  }

  return {
    payload: {
      message: messageView,
      reply: null,
      job: {
        id: job.id,
        op_type: 'assistant_chat',
        status: job.status,
        poll_url: pollUrl(job.id),
        suggested_wait_ms: SUGGESTED_WAIT_MS.assistant_chat,
      },
    },
    accepted: true,
  };
}

export type { AssistantMessageView };
