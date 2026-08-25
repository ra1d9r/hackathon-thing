import type { z } from 'zod';

import type {
  dailyPlanResponseSchema,
  DailyItemView,
  GenerateTaskRequest,
  generateTaskResponseSchema,
  skipItemResponseSchema,
  startItemResponseSchema,
  streakResponseSchema,
} from '../../contracts/dto/daily.js';
import { dailyItemStatusSchema } from '../../contracts/dto/daily.js';
import { AppError } from '../../contracts/errors.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import { itemMeta, planDailyItems } from '../../domain/daily.js';
import { localDate, resolveTimeZone } from '../../domain/day.js';
import { enqueueJob, pollUrl, SUGGESTED_WAIT_MS } from '../../queue/jobs.js';
import type { AuthUser } from '../../types/fastify.js';
import { startAttempt } from '../attempts/service.js';
import { loadStudentCurriculum } from '../curriculum/scope.js';
import { loadDailyCandidates, loadPlan, storePlan, type PlanItemRow, type PlanRow } from './queries.js';
import { readStreak } from './streak.js';

export type DailyPlanResponse = z.infer<typeof dailyPlanResponseSchema>;
export type StartItemResponse = z.infer<typeof startItemResponseSchema>;
export type SkipItemResponse = z.infer<typeof skipItemResponseSchema>;
export type StreakResponse = z.infer<typeof streakResponseSchema>;
export type GenerateTaskResponse = z.infer<typeof generateTaskResponseSchema>;

function toItemView(item: PlanItemRow): DailyItemView {
  return {
    id: item.id,
    position: item.position,
    kind: item.kind,
    title: item.title,
    meta: item.meta ?? '',
    topic: { id: item.topicId, title: item.title },
    subject_name: item.subjectName,
    est_minutes: item.estMinutes,
    status: dailyItemStatusSchema.catch('pending').parse(item.status),
    lesson_id: item.lessonId,
    assessment_id: item.assessmentId,
    attempt_id: item.attemptId,
    completed_at: item.completedAt,
  };
}

function completedCount(items: readonly PlanItemRow[]): number {
  
  
  return items.filter((item) => item.status === 'completed' || item.status === 'skipped').length;
}

async function studentDate(
  sql: SqlExecutor,
  studentId: string,
  requested: string | undefined,
): Promise<{ date: string; timezone: string }> {
  const [row] = await sql<{ timezone: string }[]>`
    select timezone from public.profiles where id = ${studentId}
  `;

  const timezone = resolveTimeZone(row?.timezone);
  return { date: requested ?? localDate(timezone), timezone };
}

async function generatePlan(
  sql: Sql,
  studentId: string,
  planDate: string,
  timezone: string,
): Promise<PlanRow | null> {
  const curriculum = await loadStudentCurriculum(sql, studentId);
  const candidates = await loadDailyCandidates(
    sql,
    studentId,
    curriculum.scope.gradeMin,
    curriculum.scope.gradeMax,
  );

  const planned = planDailyItems(candidates);
  if (planned.length === 0) {
    return null;
  }

  const created = await storePlan(sql, {
    studentId,
    planDate,
    timezone,
    source: 'fallback',
    aiJobId: null,
    items: planned.map((item) => ({
      position: item.position,
      kind: item.kind,
      topicId: item.topicId,
      subjectId: item.subjectId,
      title: item.title,
      meta: itemMeta(item.estMinutes, null),
      estMinutes: item.estMinutes,
      lessonId: item.lessonId,
    })),
  });

  if (created !== null) {
    
    
    await enqueueJob(sql, {
      opType: 'daily_plan',
      requestedBy: studentId,
      studentId,
      dedupeKey: `daily_plan:${studentId}:${planDate}`,
      input: { student_id: studentId, plan_date: planDate },
    });
  }

  return loadPlan(sql, studentId, planDate);
}

export async function getDailyPlan(
  sql: Sql,
  user: AuthUser,
  requestedDate: string | undefined,
): Promise<DailyPlanResponse> {
  const { date, timezone } = await studentDate(sql, user.id, requestedDate);
  const streak = await readStreak(sql, user.id);

  let plan = await loadPlan(sql, user.id, date);

  
  
  if (plan === null && requestedDate === undefined) {
    plan = await generatePlan(sql, user.id, date, timezone);
  }

  if (plan === null) {
    return {
      plan: null,
      items: [],
      streak: {
        current: streak.current,
        longest: streak.longest,
        today_completed: streak.lastCompletedDate === date,
      },
      empty_reason: requestedDate === undefined ? 'no_topics' : null,
    };
  }

  return {
    plan: {
      id: plan.id,
      date: plan.planDate,
      timezone: plan.timezone,
      completed: completedCount(plan.items),
      total: plan.items.length,
      source: plan.source,
      generated_at: plan.generatedAt,
    },
    items: plan.items.map(toItemView),
    streak: {
      current: streak.current,
      longest: streak.longest,
      today_completed: streak.lastCompletedDate === date,
    },
    empty_reason: null,
  };
}

interface OwnedItem {
  readonly item: PlanItemRow;
  readonly plan: PlanRow;
}

async function loadItemOwned(sql: Sql, studentId: string, itemId: string): Promise<OwnedItem> {
  const [row] = await sql<{ plan_date: Date }[]>`
    select p.plan_date
      from public.daily_plan_items i
      join public.daily_plans p on p.id = i.plan_id
     where i.id = ${itemId} and p.student_id = ${studentId}
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND');
  }

  const plan = await loadPlan(sql, studentId, row.plan_date.toISOString().slice(0, 10));
  const item = plan?.items.find((candidate) => candidate.id === itemId);

  if (plan === null || item === undefined) {
    throw new AppError('NOT_FOUND');
  }

  return { item, plan };
}

export async function startItem(
  sql: Sql,
  user: AuthUser,
  itemId: string,
  requestId: string,
): Promise<StartItemResponse> {
  const { item } = await loadItemOwned(sql, user.id, itemId);

  if (item.status === 'completed' || item.status === 'skipped') {
    throw new AppError('STATE_CONFLICT', { message: 'Пункт плана уже закрыт' });
  }

  await sql`
    update public.daily_plan_items
       set status = 'in_progress'
     where id = ${itemId} and status = 'pending'
  `;

  
  
  if (item.kind === 'lesson') {
    const refreshed = await loadItemOwned(sql, user.id, itemId);
    return {
      item: toItemView(refreshed.item),
      assessment_id: null,
      attempt_id: null,
      lesson_id: item.lessonId,
      job: null,
    };
  }

  
  
  if (item.assessmentId !== null) {
    
    
    
    const attempt = await startAttempt(
      sql,
      user,
      { assessment_id: item.assessmentId, client_attempt_id: null },
      requestId,
    );

    await sql`
      update public.daily_plan_items
         set attempt_id = ${attempt.attempt.id}
       where id = ${itemId}
    `;

    const refreshed = await loadItemOwned(sql, user.id, itemId);
    return {
      item: toItemView(refreshed.item),
      assessment_id: item.assessmentId,
      attempt_id: attempt.attempt.id,
      lesson_id: item.lessonId,
      job: null,
    };
  }

  const job = await enqueueJob(sql, {
    opType: 'task_generation',
    requestedBy: user.id,
    studentId: user.id,
    dedupeKey: `task_generation:${user.id}:${item.topicId}:daily:${item.id}`,
    input: {
      student_id: user.id,
      topic_id: item.topicId,
      daily_item_id: item.id,
    },
  });

  const refreshed = await loadItemOwned(sql, user.id, itemId);
  return {
    item: toItemView(refreshed.item),
    assessment_id: null,
    attempt_id: null,
    lesson_id: item.lessonId,
    job: {
      job_id: job.id,
      status: job.status,
      poll_url: pollUrl(job.id),
      suggested_wait_ms: SUGGESTED_WAIT_MS.task_generation,
    },
  };
}

export async function skipItem(
  sql: Sql,
  user: AuthUser,
  itemId: string,
): Promise<SkipItemResponse> {
  const { item } = await loadItemOwned(sql, user.id, itemId);

  if (item.status === 'completed') {
    throw new AppError('STATE_CONFLICT', { message: 'Выполненный пункт нельзя пропустить' });
  }

  await sql`
    update public.daily_plan_items
       set status = 'skipped', completed_at = coalesce(completed_at, now())
     where id = ${itemId}
  `;

  const after = await loadItemOwned(sql, user.id, itemId);

  return {
    item: toItemView(after.item),
    completed: completedCount(after.plan.items),
    total: after.plan.items.length,
  };
}

export async function getStreak(sql: Sql, user: AuthUser): Promise<StreakResponse> {
  const { date } = await studentDate(sql, user.id, undefined);
  const streak = await readStreak(sql, user.id);

  return {
    current: streak.current,
    longest: streak.longest,
    today_completed: streak.lastCompletedDate === date,
    date,
    last_completed_date: streak.lastCompletedDate,
  };
}

export async function generateTask(
  sql: Sql,
  user: AuthUser,
  body: GenerateTaskRequest,
  idempotencyKey: string | null,
): Promise<GenerateTaskResponse> {
  const curriculum = await loadStudentCurriculum(sql, user.id);

  const [topic] = await sql<{ id: string; subject_id: string }[]>`
    select t.id, t.subject_id
      from public.topics t
     where t.id = ${body.topic_id}
       and t.is_active
       and t.subject_id = any(${[...curriculum.subjectIds]}::uuid[])
       and t.grade_min <= ${curriculum.scope.gradeMax}::int
       and t.grade_max >= ${curriculum.scope.gradeMin}::int
  `;

  
  
  if (topic === undefined) {
    throw new AppError('NOT_FOUND');
  }

  const scope = idempotencyKey ?? `manual:${localDate(resolveTimeZone(null))}`;
  const job = await enqueueJob(sql, {
    opType: 'task_generation',
    requestedBy: user.id,
    studentId: user.id,
    dedupeKey: `task_generation:${user.id}:${topic.id}:${scope}`,
    idempotencyKey,
    input: {
      student_id: user.id,
      topic_id: topic.id,
      question_count: body.question_count ?? null,
    },
  });

  return {
    job_id: job.id,
    status: job.status,
    poll_url: pollUrl(job.id),
    suggested_wait_ms: SUGGESTED_WAIT_MS.task_generation,
    created: job.created,
  };
}
