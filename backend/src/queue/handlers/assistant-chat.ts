import { z } from 'zod';

import {
  askAssistant,
  ASSISTANT_TOPIC_LIMIT,
  HISTORY_DEPTH,
  type AssistantPlanItem,
  type AssistantWeakTopic,
} from '../../ai/ops/assistant.js';
import type { AssistantReply, SuggestedAction } from '../../contracts/ai/assistant.js';
import type { JsonObject } from '../../contracts/json.js';
import { MARKDOWN_LIMITS, normalizeMarkdown } from '../../contracts/markdown.js';
import type { SqlExecutor } from '../../db/sql.js';
import { localDate, resolveTimeZone } from '../../domain/day.js';
import { unclearQuestionText, unreviewedText } from '../../domain/moderation.js';
import { recentTurns } from '../../modules/assistant/queries.js';
import { loadScopedTopics, loadStudentCurriculum } from '../../modules/curriculum/scope.js';
import { loadPlan } from '../../modules/daily/queries.js';
import { readStreak } from '../../modules/daily/streak.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../types.js';

const inputSchema = z.object({
  student_id: z.uuid(),
  channel_id: z.uuid(),
  message_id: z.uuid(),
  topic_id: z.uuid().optional(),
});

interface MessageContext {
  readonly channelId: string;
  readonly text: string;
  readonly timezone: string;
  
  readonly moderation: string;
  
  readonly screen: string | null;
}

async function loadMessage(
  sql: SqlExecutor,
  studentId: string,
  messageId: string,
): Promise<MessageContext | null> {
  const [row] = await sql<
    {
      channel_id: string;
      body_md: string;
      timezone: string | null;
      moderation: string;
      screen: string | null;
    }[]
  >`
    select m.channel_id, m.body_md, p.timezone,
           m.moderation::text as moderation, m.meta ->> 'screen' as screen
      from public.chat_messages m
      join public.chat_channels c on c.id = m.channel_id
      join public.profiles p on p.id = ${studentId}
     where m.id = ${messageId}
       and m.sender_id = ${studentId}
       and c.kind = 'ai_assistant'
       and c.owner_id = ${studentId}
  `;

  if (row === undefined) {
    return null;
  }

  return {
    channelId: row.channel_id,
    text: row.body_md,
    timezone: resolveTimeZone(row.timezone),
    moderation: row.moderation,
    screen: row.screen,
  };
}

async function lessonsByTopic(
  sql: SqlExecutor,
  topicIds: readonly string[],
): Promise<Map<string, string>> {
  if (topicIds.length === 0) {
    return new Map();
  }

  const rows = await sql<{ topic_id: string; id: string }[]>`
    select distinct on (topic_id) topic_id, id
      from public.lessons
     where topic_id = any(${[...topicIds]}::uuid[]) and is_active
     order by topic_id, sort_order, id
  `;

  return new Map(rows.map((row) => [row.topic_id, row.id]));
}

async function validateReferences(
  sql: SqlExecutor,
  reply: AssistantReply,
  allowedTopicIds: ReadonlySet<string>,
): Promise<{ topics: string[]; actions: SuggestedAction[]; rejected: number }> {
  const topics = [...new Set(reply.referenced_topics)].filter((id) => allowedTopicIds.has(id));

  const wanted = reply.suggested_actions.filter((action) => allowedTopicIds.has(action.ref_id));
  const lessons = await lessonsByTopic(
    sql,
    wanted.filter((action) => action.kind === 'open_lesson').map((action) => action.ref_id),
  );

  const seen = new Set<string>();
  const actions: SuggestedAction[] = [];

  for (const action of wanted) {
    if (action.kind === 'open_lesson') {
      const lessonId = lessons.get(action.ref_id);
      if (lessonId === undefined) {
        continue;
      }
      const key = `${action.kind}:${lessonId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      actions.push({ ...action, ref_id: lessonId });
      continue;
    }

    const key = `${action.kind}:${action.ref_id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    actions.push(action);
  }

  const rejected =
    reply.referenced_topics.length -
    topics.length +
    (reply.suggested_actions.length - actions.length);

  return { topics, actions, rejected };
}

function fallbackReply(weak: readonly AssistantWeakTopic[]): { text: string; topics: string[] } {
  const shortlist = weak.slice(0, 3);

  if (shortlist.length === 0) {
    return {
      text: [
        'Сейчас я не могу ответить — помощник временно недоступен. Попробуй ещё раз ',
        'через несколько минут.',
        '\n\n',
        'Пока можно открыть дневной план: задачи и уроки в нём работают и без меня.',
      ].join(''),
      topics: [],
    };
  }

  return {
    text: [
      'Сейчас я не могу ответить — помощник временно недоступен. Попробуй ещё раз ',
      'через несколько минут.',
      '\n\n',
      'А пока вот темы, которые ждут внимания:',
      '\n\n',
      shortlist
        .map(
          (topic) =>
            `- ${topic.title}${topic.masteryPct === null ? '' : ` — ${String(Math.round(topic.masteryPct))}%`}`,
        )
        .join('\n'),
    ].join(''),
    topics: shortlist.map((topic) => topic.topicId),
  };
}

async function loadPlanItems(
  sql: SqlExecutor,
  studentId: string,
  timezone: string,
): Promise<AssistantPlanItem[]> {
  const plan = await loadPlan(sql, studentId, localDate(timezone));
  if (plan === null) {
    return [];
  }

  return plan.items.map((item) => ({
    kind: item.kind,
    title: item.title,
    status: item.status,
  }));
}

async function refuseUnreviewed(
  ctx: Parameters<JobHandler>[0],
  message: MessageContext,
  messageId: string,
): Promise<JsonObject> {
  return ctx.applyOnce(async (tx) => {
    await tx`
      update public.chat_messages
         set moderation = 'block'::public.moderation_verdict,
             meta = meta || ${tx.json({ screen: 'reviewed', moderation_source: 'fallback' })}
       where id = ${messageId}
    `;

    const [row] = await tx<{ id: string }[]>`
      insert into public.chat_messages (
        channel_id, sender_id, sender_kind, body_md, moderation, ai_job_id, meta
      ) values (
        ${message.channelId},
        null,
        'ai'::public.sender_kind,
        ${unreviewedText()},
        'block'::public.moderation_verdict,
        ${ctx.job.id},
        ${tx.json({
          source: 'fallback',
          in_reply_to: messageId,
          refusal_reason: 'unsafe',
          reason: 'unreviewed',
          referenced_topics: [],
          suggested_actions: [],
        })}
      )
      returning id
    `;

    if (row === undefined) {
      throw new Error('отказ по непроверенному вопросу не записан');
    }

    return { source: 'fallback', message_id: messageId, reply_id: row.id, unreviewed: true };
  });
}

export const assistantChat: JobHandler = async (ctx) => {
  const parsed = inputSchema.safeParse(ctx.job.input);
  if (!parsed.success) {
    throw new PermanentJobError('во входе операции нет ученика или сообщения', 'BAD_INPUT');
  }

  const { student_id: studentId, message_id: messageId } = parsed.data;

  const message = await loadMessage(ctx.sql, studentId, messageId);
  if (message === null) {
    throw new PermanentJobError('сообщение не найдено', 'MESSAGE_NOT_FOUND');
  }

  
  
  if (message.moderation !== 'allow') {
    return { skipped: true, reason: 'moderation', verdict: message.moderation };
  }

  
  
  
  
  if (message.screen === 'review') {
    ctx.log.warn(
      { job_id: ctx.job.id, message_id: messageId },
      'вопрос помечен на проверку, но проверка не завершилась — ответ не даётся',
    );
    return refuseUnreviewed(ctx, message, messageId);
  }

  const curriculum = await loadStudentCurriculum(ctx.sql, studentId);
  const scoped = await loadScopedTopics(ctx.sql, studentId, curriculum, {
    limit: ASSISTANT_TOPIC_LIMIT,
  });

  
  
  
  const weak: AssistantWeakTopic[] = scoped
    .filter((topic) => topic.masteryPct !== null && topic.masteryPct < 60)
    .slice(0, 5)
    .map((topic) => ({ topicId: topic.topicId, title: topic.title, masteryPct: topic.masteryPct }));

  const allowedTopicIds = new Set(scoped.map((topic) => topic.topicId));

  let replyText: string;
  let refusalReason: AssistantReply['refusal_reason'] = 'none';
  let refused = false;
  let topics: string[] = [];
  let actions: SuggestedAction[] = [];
  let source: 'ai' | 'fallback' = 'fallback';
  let rejected = 0;

  const caller = await ctx.model();

  if (caller === null) {
    const fallback = fallbackReply(weak);
    replyText = fallback.text;
    topics = fallback.topics;
  } else {
    const screenTopic =
      parsed.data.topic_id === undefined
        ? null
        : (scoped.find((topic) => topic.topicId === parsed.data.topic_id) ?? null);

    const outcome = await askAssistant(ctx.sql, caller, {
      messageId,
      question: message.text,
      grade: curriculum.grade,
      goal: curriculum.goal,
      examCode: curriculum.examCode,
      scope: curriculum.scope,
      subjectNames: curriculum.subjects.map((subject) => subject.name),
      topicIds: scoped.map((topic) => topic.topicId),
      weakTopics: weak,
      planItems: await loadPlanItems(ctx.sql, studentId, message.timezone),
      streakDays: (await readStreak(ctx.sql, studentId)).current,
      screenTopic:
        screenTopic === null ? null : { id: screenTopic.topicId, title: screenTopic.title },
      history: await recentTurns(ctx.sql, message.channelId, messageId, HISTORY_DEPTH),
      sensitive: message.screen === 'reviewed',
    });

    await ctx.logCalls(outcome.calls);

    if (outcome.reply === null) {
      if (outcome.failure === 'unavailable' && ctx.retryOnModelOutage()) {
        throw new TransientJobError(`провайдер недоступен: ${outcome.reason ?? ''}`);
      }

      ctx.log.warn(
        { job_id: ctx.job.id, failure: outcome.failure, reason: outcome.reason },
        'ассистент не ответил, применяется заменитель',
      );

      if (outcome.failure === 'insufficient_context') {
        
        
        
        replyText = unclearQuestionText();
      } else {
        const fallback = fallbackReply(weak);
        replyText = fallback.text;
        topics = fallback.topics;
      }
    } else {
      const checked = await validateReferences(ctx.sql, outcome.reply, allowedTopicIds);

      replyText = normalizeMarkdown(outcome.reply.reply_md, {
        maxLength: MARKDOWN_LIMITS.message,
      });
      refused = outcome.reply.refused;
      refusalReason = outcome.reply.refusal_reason;
      topics = checked.topics;
      actions = checked.actions;
      rejected = checked.rejected;
      source = 'ai';

      
      
      
      if (replyText === '') {
        const fallback = fallbackReply(weak);
        replyText = fallback.text;
        topics = fallback.topics;
        actions = [];
        refused = false;
        refusalReason = 'none';
        source = 'fallback';
      }
    }
  }

  const verdict = refused ? (refusalReason === 'unsafe' ? 'block' : 'redirect') : 'allow';

  return ctx.applyOnce(async (tx) => {
    const meta: JsonObject = {
      source,
      in_reply_to: messageId,
      refusal_reason: refusalReason,
      referenced_topics: topics,
      suggested_actions: actions,
      ...(rejected > 0 ? { rejected } : {}),
    };

    const [row] = await tx<{ id: string }[]>`
      insert into public.chat_messages (
        channel_id, sender_id, sender_kind, body_md, moderation, ai_job_id, meta
      ) values (
        ${message.channelId},
        null,
        'ai'::public.sender_kind,
        ${replyText},
        ${verdict}::public.moderation_verdict,
        ${ctx.job.id},
        ${tx.json(meta)}
      )
      returning id
    `;

    if (row === undefined) {
      throw new Error('ответ ассистента не записан');
    }

    return {
      source,
      message_id: messageId,
      reply_id: row.id,
      refused,
      refusal_reason: refusalReason,
      referenced_topics: topics.length,
      suggested_actions: actions.length,
      rejected,
    };
  });
};
