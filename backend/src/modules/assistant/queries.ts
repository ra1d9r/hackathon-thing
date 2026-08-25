import type { AssistantMessageView } from '../../contracts/dto/assistant.js';
import {
  moderationDecisionSchema,
  refusalReasonSchema,
  suggestedActionSchema,
  type ModerationDecision,
  type RefusalReason,
  type SuggestedAction,
} from '../../contracts/ai/assistant.js';
import { isJsonObject } from '../../contracts/json.js';
import { parseMarkdown } from '../../contracts/markdown.js';
import type { SqlExecutor } from '../../db/sql.js';

export const ASSISTANT_CHANNEL_TITLE = 'ИИ-ассистент';

export interface AssistantChannel {
  readonly id: string;
  readonly title: string;
  readonly createdAt: Date;
  readonly lastReadAt: Date | null;
}

interface ChannelRow {
  id: string;
  title: string;
  created_at: Date;
  last_read_at: Date | null;
}

export async function ensureChannel(sql: SqlExecutor, studentId: string): Promise<AssistantChannel> {
  await sql`
    insert into public.chat_channels (kind, owner_id, title)
    values ('ai_assistant', ${studentId}, ${ASSISTANT_CHANNEL_TITLE})
    on conflict do nothing
  `;

  const [channel] = await sql<{ id: string }[]>`
    select id from public.chat_channels
     where kind = 'ai_assistant' and owner_id = ${studentId}
  `;

  if (channel === undefined) {
    throw new Error('канал ассистента не создан');
  }

  
  
  await sql`
    insert into public.chat_channel_members (channel_id, user_id)
    values (${channel.id}, ${studentId})
    on conflict do nothing
  `;

  const [row] = await sql<ChannelRow[]>`
    select c.id, c.title, c.created_at, m.last_read_at
      from public.chat_channels c
      left join public.chat_channel_members m
             on m.channel_id = c.id and m.user_id = ${studentId}
     where c.id = ${channel.id}
  `;

  if (row === undefined) {
    throw new Error('канал ассистента не найден после создания');
  }

  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    lastReadAt: row.last_read_at,
  };
}

export interface MessageRow {
  id: string;
  sender_kind: 'user' | 'ai' | 'system';
  body_md: string;
  moderation: ModerationDecision;
  client_msg_id: string | null;
  ai_job_id: string | null;
  meta: unknown;
  created_at: Date;
}

const MESSAGE_COLUMNS = 'id, sender_kind::text as sender_kind, body_md, moderation::text as moderation, client_msg_id, ai_job_id, meta, created_at';

function readRefusalReason(meta: unknown): RefusalReason {
  if (!isJsonObject(meta)) {
    return 'none';
  }
  const parsed = refusalReasonSchema.safeParse(meta['refusal_reason']);
  return parsed.success ? parsed.data : 'none';
}

function readSource(meta: unknown): AssistantMessageView['source'] {
  if (!isJsonObject(meta)) {
    return null;
  }
  const value = meta['source'];
  return value === 'ai' || value === 'fallback' || value === 'moderation' ? value : null;
}

function readActions(meta: unknown): SuggestedAction[] {
  if (!isJsonObject(meta) || !Array.isArray(meta['suggested_actions'])) {
    return [];
  }
  
  
  return meta['suggested_actions'].flatMap((raw: unknown) => {
    const parsed = suggestedActionSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

function readTopicIds(meta: unknown): string[] {
  if (!isJsonObject(meta) || !Array.isArray(meta['referenced_topics'])) {
    return [];
  }
  return meta['referenced_topics'].filter((value): value is string => typeof value === 'string');
}

async function topicTitles(
  sql: SqlExecutor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }

  const rows = await sql<{ id: string; title_ru: string }[]>`
    select id, title_ru from public.topics where id = any(${[...ids]}::uuid[])
  `;

  return new Map(rows.map((row) => [row.id, row.title_ru]));
}

export async function toMessageViews(
  sql: SqlExecutor,
  rows: readonly MessageRow[],
): Promise<AssistantMessageView[]> {
  const allTopicIds = [...new Set(rows.flatMap((row) => readTopicIds(row.meta)))];
  const titles = await topicTitles(sql, allTopicIds);

  return rows.map((row) => ({
    id: row.id,
    sender_kind: row.sender_kind,
    body_md: row.body_md,
    
    
    body_blocks: parseMarkdown(row.body_md),
    moderation: moderationDecisionSchema.catch('allow').parse(row.moderation),
    refusal_reason: readRefusalReason(row.meta),
    referenced_topics: readTopicIds(row.meta).flatMap((id) => {
      const title = titles.get(id);
      
      
      return title === undefined ? [] : [{ id, title }];
    }),
    suggested_actions: readActions(row.meta),
    source: readSource(row.meta),
    client_msg_id: row.client_msg_id,
    ai_job_id: row.ai_job_id,
    created_at: row.created_at.toISOString(),
  }));
}

export interface HistoryPage {
  readonly rows: readonly MessageRow[];
  readonly hasMore: boolean;
}

export async function loadHistory(
  sql: SqlExecutor,
  channelId: string,
  options: { readonly before?: string | undefined; readonly limit: number },
): Promise<HistoryPage> {
  const probe = options.limit + 1;

  const rows =
    options.before === undefined
      ? await sql<MessageRow[]>`
          select ${sql.unsafe(MESSAGE_COLUMNS)}
            from public.chat_messages
           where channel_id = ${channelId} and deleted_at is null
           order by created_at desc, id desc
           limit ${probe}
        `
      : await sql<MessageRow[]>`
          select ${sql.unsafe(MESSAGE_COLUMNS)}
            from public.chat_messages
           where channel_id = ${channelId}
             and deleted_at is null
             and (created_at, id) < (
               -- Курсор сверяется в пределах канала: чужой идентификатор
               -- не должен задавать позицию в этой переписке. Строки нет —
               -- сравнение даёт NULL, и страница выходит пустой.
               select created_at, id
                 from public.chat_messages
                where id = ${options.before} and channel_id = ${channelId}
             )
           order by created_at desc, id desc
           limit ${probe}
        `;

  return { rows: rows.slice(0, options.limit), hasMore: rows.length === probe };
}

export async function lastMessage(
  sql: SqlExecutor,
  channelId: string,
): Promise<MessageRow | null> {
  const [row] = await sql<MessageRow[]>`
    select ${sql.unsafe(MESSAGE_COLUMNS)}
      from public.chat_messages
     where channel_id = ${channelId} and deleted_at is null
     order by created_at desc, id desc
     limit 1
  `;

  return row ?? null;
}

export async function unreadCount(
  sql: SqlExecutor,
  channelId: string,
  lastReadAt: Date | null,
): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from public.chat_messages
     where channel_id = ${channelId}
       and deleted_at is null
       and sender_kind <> 'user'
       and (${lastReadAt}::timestamptz is null or created_at > ${lastReadAt}::timestamptz)
  `;

  return row?.n ?? 0;
}

export async function recentTurns(
  sql: SqlExecutor,
  channelId: string,
  beforeMessageId: string,
  depth: number,
): Promise<{ role: 'student' | 'assistant'; text: string }[]> {
  const rows = await sql<{ sender_kind: string; body_md: string }[]>`
    select sender_kind::text as sender_kind, body_md
      from public.chat_messages
     where channel_id = ${channelId}
       and deleted_at is null
       and sender_kind in ('user','ai')
       and (created_at, id) < (
         select created_at, id
           from public.chat_messages
          where id = ${beforeMessageId} and channel_id = ${channelId}
       )
     order by created_at desc, id desc
     limit ${depth}
  `;

  return rows
    .reverse()
    .map((row) => ({
      role: row.sender_kind === 'user' ? ('student' as const) : ('assistant' as const),
      text: row.body_md,
    }));
}
