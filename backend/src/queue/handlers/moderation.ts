import { z } from 'zod';

import { moderateMessage } from '../../ai/ops/moderation.js';
import {
  moderationCategorySchema,
  type ModerationCategory,
  type ModerationDecision,
} from '../../contracts/ai/assistant.js';
import type { JsonObject } from '../../contracts/json.js';
import type { SqlExecutor } from '../../db/sql.js';
import { refusalText, unreviewedText } from '../../domain/moderation.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../types.js';

const inputSchema = z.object({
  student_id: z.uuid(),
  message_id: z.uuid(),
  suspected_category: z.string().max(40),
});

interface MessageRow {
  channel_id: string;
  body_md: string;
  grade: number | null;
}

async function loadMessage(
  sql: SqlExecutor,
  studentId: string,
  messageId: string,
): Promise<MessageRow | null> {
  const [row] = await sql<MessageRow[]>`
    select m.channel_id, m.body_md, p.grade
      from public.chat_messages m
      join public.chat_channels c on c.id = m.channel_id
      join public.profiles p on p.id = ${studentId}
     where m.id = ${messageId}
       and m.sender_id = ${studentId}
       and c.kind = 'ai_assistant'
       and c.owner_id = ${studentId}
  `;

  return row ?? null;
}

interface Decision {
  readonly verdict: ModerationDecision;
  readonly category: ModerationCategory;
  readonly source: 'ai' | 'fallback';
  readonly rationale: string;
}

async function apply(
  tx: SqlExecutor,
  jobId: string,
  message: MessageRow,
  messageId: string,
  decision: Decision,
): Promise<JsonObject> {
  
  
  
  await tx`
    update public.chat_messages
       set moderation = ${decision.verdict}::public.moderation_verdict,
           meta = meta || ${tx.json({
             screen: 'reviewed',
             moderation_verdict: decision.verdict,
             moderation_category: decision.category,
             moderation_source: decision.source,
           })}
     where id = ${messageId}
  `;

  if (decision.verdict === 'allow') {
    return {
      source: decision.source,
      verdict: decision.verdict,
      category: decision.category,
      message_id: messageId,
      canceled_reply: false,
    };
  }

  const meta: JsonObject = {
    source: decision.source === 'ai' ? 'moderation' : 'fallback',
    
    
    in_reply_to: messageId,
    refusal_reason: 'unsafe',
    moderation_category: decision.category,
    rationale: decision.rationale,
    referenced_topics: [],
    suggested_actions: [],
    ...(decision.source === 'fallback' ? { reason: 'unreviewed' } : {}),
  };

  await tx`
    insert into public.chat_messages (
      channel_id, sender_id, sender_kind, body_md, moderation, ai_job_id, meta
    ) values (
      ${message.channel_id},
      null,
      'ai'::public.sender_kind,
      ${decision.source === 'fallback' ? unreviewedText() : refusalText(decision.category)},
      ${decision.verdict}::public.moderation_verdict,
      ${jobId},
      ${tx.json(meta)}
    )
  `;

  const canceled = await tx<{ id: string }[]>`
    update public.ai_jobs
       set status = 'canceled', finished_at = now()
     where depends_on_job_id = ${jobId}
       and status in ('queued','awaiting_retry')
    returning id
  `;

  return {
    source: decision.source,
    verdict: decision.verdict,
    category: decision.category,
    message_id: messageId,
    canceled_reply: canceled.length > 0,
  };
}

export const moderation: JobHandler = async (ctx) => {
  const parsed = inputSchema.safeParse(ctx.job.input);
  if (!parsed.success) {
    throw new PermanentJobError('во входе операции нет ученика или сообщения', 'BAD_INPUT');
  }

  const { student_id: studentId, message_id: messageId } = parsed.data;

  const message = await loadMessage(ctx.sql, studentId, messageId);
  if (message === null) {
    throw new PermanentJobError('сообщение не найдено', 'MESSAGE_NOT_FOUND');
  }

  const suspected = moderationCategorySchema.catch('other').parse(parsed.data.suspected_category);
  const caller = await ctx.model();

  if (caller !== null) {
    const outcome = await moderateMessage(caller, {
      messageId,
      text: message.body_md,
      grade: message.grade ?? 11,
      suspectedCategory: suspected,
    });

    await ctx.logCalls(outcome.calls);

    const { verdict } = outcome;
    if (verdict !== null) {
      return ctx.applyOnce(async (tx) =>
        apply(tx, ctx.job.id, message, messageId, {
          verdict: verdict.verdict,
          category: verdict.category,
          source: 'ai',
          rationale: verdict.rationale,
        }),
      );
    }

    if (outcome.failure === 'unavailable' && ctx.retryOnModelOutage()) {
      throw new TransientJobError(`провайдер недоступен: ${outcome.reason ?? ''}`);
    }

    ctx.log.warn(
      { job_id: ctx.job.id, failure: outcome.failure, reason: outcome.reason },
      'вердикт модерации не получен, применяется заменитель',
    );
  }

  return ctx.applyOnce(async (tx) =>
    apply(tx, ctx.job.id, message, messageId, {
      verdict: 'block',
      category: suspected,
      source: 'fallback',
      rationale: 'проверка сообщения недоступна, применён заменитель',
    }),
  );
};
