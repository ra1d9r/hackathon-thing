import type {
  ChatChannelListResponse,
  ChatChannelView,
  ChatMessagesQuery,
  ChatMessagesResponse,
  ChatMessageView,
  ChatReadResponse,
  PostChatMessageRequest,
  PostChatMessageResponse,
} from '../../contracts/dto/chat.js';
import { moderationDecisionSchema } from '../../contracts/ai/assistant.js';
import { AppError } from '../../contracts/errors.js';
import { MARKDOWN_LIMITS, normalizeMarkdown, parseMarkdown } from '../../contracts/markdown.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import { refusalText, screenMessage } from '../../domain/moderation.js';
import type { AuthUser } from '../../types/fastify.js';

const DEFAULT_PAGE_SIZE = 50;

const MESSAGE_COLUMNS = `
  m.id, m.channel_id, m.sender_kind::text as sender_kind, m.body_md,
  m.moderation::text as moderation, m.client_msg_id, m.created_at, m.edited_at,
  p.id as sender_id, p.display_name as sender_name, p.role::text as sender_role
`;

const MESSAGE_FROM = `
  from public.chat_messages m
  left join public.profiles p on p.id = m.sender_id
`;

interface MessageRow {
  id: string;
  channel_id: string;
  sender_kind: string;
  body_md: string;
  moderation: string;
  client_msg_id: string | null;
  created_at: Date;
  edited_at: Date | null;
  sender_id: string | null;
  sender_name: string | null;
  sender_role: string | null;
}

function toMessageView(row: MessageRow): ChatMessageView {
  const kind = row.sender_kind;

  return {
    id: row.id,
    channel_id: row.channel_id,
    sender_kind: kind === 'ai' || kind === 'system' ? kind : 'user',
    sender:
      row.sender_id === null || row.sender_name === null
        ? null
        : {
            id: row.sender_id,
            display_name: row.sender_name,
            role: row.sender_role === 'teacher' ? 'teacher' : 'student',
          },
    body_md: row.body_md,
    
    
    body_blocks: parseMarkdown(row.body_md),
    moderation: moderationDecisionSchema.catch('allow').parse(row.moderation),
    client_msg_id: row.client_msg_id,
    created_at: row.created_at.toISOString(),
    edited_at: row.edited_at?.toISOString() ?? null,
  };
}

async function memberChannel(
  sql: SqlExecutor,
  userId: string,
  channelId: string,
): Promise<{ id: string; kind: string; lastReadAt: Date | null }> {
  const [row] = await sql<{ id: string; kind: string; last_read_at: Date | null }[]>`
    select c.id, c.kind::text as kind, m.last_read_at
      from public.chat_channels c
      join public.chat_channel_members m on m.channel_id = c.id and m.user_id = ${userId}
     where c.id = ${channelId}
  `;

  
  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Канал не найден' });
  }

  return { id: row.id, kind: row.kind, lastReadAt: row.last_read_at };
}

interface ChannelRow {
  id: string;
  kind: string;
  title: string;
  class_id: string | null;
  member_count: number;
  unread: number;
  last_read_at: Date | null;
  last_message_at: Date | null;
  last_message_preview: string | null;
  created_at: Date;
}

function toChannelView(row: ChannelRow): ChatChannelView {
  return {
    id: row.id,
    kind: row.kind === 'ai_assistant' ? 'ai_assistant' : 'class_chat',
    title: row.title,
    class_id: row.class_id,
    member_count: row.member_count,
    unread: row.unread,
    last_read_at: row.last_read_at?.toISOString() ?? null,
    last_message_at: row.last_message_at?.toISOString() ?? null,
    last_message_preview: row.last_message_preview,
    created_at: row.created_at.toISOString(),
  };
}

export async function listChannels(
  sql: Sql,
  user: AuthUser,
): Promise<ChatChannelListResponse> {
  const rows = await sql<ChannelRow[]>`
    select c.id, c.kind::text as kind, c.title, c.class_id, c.created_at,
           mem.last_read_at,
           (
             select count(*)::int from public.chat_channel_members x
              where x.channel_id = c.id
           ) as member_count,
           (
             select count(*)::int
               from public.chat_messages msg
              where msg.channel_id = c.id
                and msg.deleted_at is null
                and msg.sender_id is distinct from ${user.id}
                and (mem.last_read_at is null or msg.created_at > mem.last_read_at)
           ) as unread,
           last_msg.created_at as last_message_at,
           left(last_msg.body_md, 120) as last_message_preview
      from public.chat_channels c
      join public.chat_channel_members mem
        on mem.channel_id = c.id and mem.user_id = ${user.id}
      left join lateral (
        select msg.body_md, msg.created_at
          from public.chat_messages msg
         where msg.channel_id = c.id and msg.deleted_at is null
         order by msg.created_at desc, msg.id desc
         limit 1
      ) last_msg on true
     order by last_msg.created_at desc nulls last, c.created_at desc, c.id
  `;

  return {
    channels: rows.map(toChannelView),
    empty_reason: rows.length === 0 ? 'no_channels' : null,
  };
}

export async function getMessages(
  sql: Sql,
  user: AuthUser,
  channelId: string,
  query: ChatMessagesQuery,
): Promise<ChatMessagesResponse> {
  await memberChannel(sql, user.id, channelId);

  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  const probe = limit + 1;

  const rows =
    query.before === undefined
      ? await sql<MessageRow[]>`
          select ${sql.unsafe(MESSAGE_COLUMNS)} ${sql.unsafe(MESSAGE_FROM)}
           where m.channel_id = ${channelId} and m.deleted_at is null
           order by m.created_at desc, m.id desc
           limit ${probe}
        `
      : await sql<MessageRow[]>`
          select ${sql.unsafe(MESSAGE_COLUMNS)} ${sql.unsafe(MESSAGE_FROM)}
           where m.channel_id = ${channelId}
             and m.deleted_at is null
             and (m.created_at, m.id) < (
               select created_at, id from public.chat_messages
                where id = ${query.before} and channel_id = ${channelId}
             )
           order by m.created_at desc, m.id desc
           limit ${probe}
        `;

  const page = rows.slice(0, limit);
  const oldest = page.at(-1);

  return {
    
    
    messages: page.map(toMessageView).reverse(),
    next_before: rows.length === probe && oldest !== undefined ? oldest.id : null,
    has_more: rows.length === probe,
    empty_reason: page.length === 0 && query.before === undefined ? 'no_messages' : null,
  };
}

export async function postMessage(
  sql: Sql,
  user: AuthUser,
  channelId: string,
  body: PostChatMessageRequest,
): Promise<PostChatMessageResponse> {
  const channel = await memberChannel(sql, user.id, channelId);

  
  
  if (channel.kind !== 'class_chat') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Это канал ассистента — пишите через /v1/assistant/messages',
    });
  }

  const existing = await findByClientId(sql, channelId, user.id, body.client_msg_id);
  if (existing !== null) {
    return { message: existing, created: false };
  }

  const text = normalizeMarkdown(body.text, { maxLength: MARKDOWN_LIMITS.message });
  if (text === '') {
    throw new AppError('VALIDATION_FAILED', { message: 'Пустое сообщение' });
  }

  
  
  const screen = screenMessage(text);
  if (screen.decision === 'block' || screen.decision === 'redirect') {
    throw new AppError('VALIDATION_FAILED', {
      message: refusalText(screen.category),
      details: { moderation: screen.decision, category: screen.category },
    });
  }

  try {
    const [row] = await sql<MessageRow[]>`
      with inserted as (
        insert into public.chat_messages (
          channel_id, sender_id, sender_kind, body_md, client_msg_id, moderation
        ) values (
          ${channelId}, ${user.id}, 'user', ${text}, ${body.client_msg_id}, 'allow'
        )
        returning *
      )
      -- Псевдоним m тот же, что в MESSAGE_FROM, поэтому список колонок
      -- подходит без изменений.
      select ${sql.unsafe(MESSAGE_COLUMNS)}
        from inserted m
        left join public.profiles p on p.id = m.sender_id
    `;

    if (row === undefined) {
      throw new Error('сообщение не записано');
    }

    return { message: toMessageView(row), created: true };
  } catch (error: unknown) {
    
    
    
    if (isUniqueViolation(error)) {
      const replayed = await findByClientId(sql, channelId, user.id, body.client_msg_id);
      if (replayed !== null) {
        return { message: replayed, created: false };
      }
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function findByClientId(
  sql: SqlExecutor,
  channelId: string,
  senderId: string,
  clientMsgId: string,
): Promise<ChatMessageView | null> {
  const [row] = await sql<MessageRow[]>`
    select ${sql.unsafe(MESSAGE_COLUMNS)} ${sql.unsafe(MESSAGE_FROM)}
     where m.channel_id = ${channelId}
       and m.sender_id = ${senderId}
       and m.client_msg_id = ${clientMsgId}
  `;

  return row === undefined ? null : toMessageView(row);
}

export async function markRead(
  sql: Sql,
  user: AuthUser,
  channelId: string,
): Promise<ChatReadResponse> {
  await memberChannel(sql, user.id, channelId);

  const [row] = await sql<{ last_read_at: Date }[]>`
    update public.chat_channel_members
       set last_read_at = now()
     where channel_id = ${channelId} and user_id = ${user.id}
    returning last_read_at
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Канал не найден' });
  }

  const [unread] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from public.chat_messages
     where channel_id = ${channelId}
       and deleted_at is null
       and sender_id is distinct from ${user.id}
       and created_at > ${row.last_read_at}::timestamptz
  `;

  return {
    channel_id: channelId,
    last_read_at: row.last_read_at.toISOString(),
    unread: unread?.n ?? 0,
  };
}
