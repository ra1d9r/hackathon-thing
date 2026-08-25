import { z } from 'zod';

import { proposeDailyPlan, type DailyCandidateContext } from '../../ai/ops/daily-plan.js';
import type { JsonObject } from '../../contracts/json.js';
import { itemMeta } from '../../domain/daily.js';
import { loadStudentCurriculum } from '../../modules/curriculum/scope.js';
import { loadDailyCandidates, loadPlan } from '../../modules/daily/queries.js';
import { readStreak } from '../../modules/daily/streak.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../types.js';

const inputSchema = z.object({ student_id: z.uuid(), plan_date: z.string() });

export const dailyPlan: JobHandler = async (ctx) => {
  const parsed = inputSchema.safeParse(ctx.job.input);
  if (!parsed.success) {
    throw new PermanentJobError('во входе операции нет ученика или даты', 'BAD_INPUT');
  }

  const { student_id: studentId, plan_date: planDate } = parsed.data;

  const plan = await loadPlan(ctx.sql, studentId, planDate);
  if (plan === null) {
    throw new PermanentJobError('плана на эту дату нет', 'PLAN_NOT_FOUND');
  }

  const untouched = plan.items.every((item) => item.status === 'pending');
  if (!untouched) {
    return { applied: false, reason: 'план уже начат' };
  }

  const caller = await ctx.model();
  if (caller === null) {
    
    
    return { applied: false, reason: 'модель недоступна' };
  }

  const curriculum = await loadStudentCurriculum(ctx.sql, studentId);
  const candidates = await loadDailyCandidates(
    ctx.sql,
    studentId,
    curriculum.scope.gradeMin,
    curriculum.scope.gradeMax,
  );

  const withLesson = candidates.filter((candidate) => candidate.lessonId !== null);
  if (withLesson.length === 0) {
    throw new PermanentJobError('нет тем, из которых можно собрать план', 'NO_TOPICS');
  }

  const subjectNames = new Map(curriculum.subjects.map((subject) => [subject.id, subject.name]));
  const context: DailyCandidateContext[] = withLesson.map((candidate) => ({
    topicId: candidate.topicId,
    title: candidate.title,
    subjectName: subjectNames.get(candidate.subjectId) ?? '',
    masteryPct: candidate.masteryPct,
    priority: candidate.priority,
    daysSincePractice: candidate.daysSincePractice,
    inRoadmap: candidate.nodePosition !== null,
  }));

  const streak = await readStreak(ctx.sql, studentId);

  const outcome = await proposeDailyPlan(caller, {
    planDate,
    goalTitle: curriculum.goal,
    scope: curriculum.scope,
    subjectNames: curriculum.subjects.map((subject) => subject.name),
    current: plan.items.map((item) => ({
      position: item.position,
      kind: item.kind,
      topicId: item.topicId,
      title: item.title,
    })),
    candidates: context,
    streakDays: streak.current,
  });

  await ctx.logCalls(outcome.calls);

  if (outcome.items === null) {
    if (outcome.failure === 'unavailable' && ctx.retryOnModelOutage()) {
      throw new TransientJobError(`провайдер недоступен: ${outcome.reason ?? ''}`);
    }
    ctx.log.warn(
      { job_id: ctx.job.id, failure: outcome.failure, reason: outcome.reason },
      'план моделью не уточнён, остаётся расчётный',
    );
    return { applied: false, reason: outcome.reason ?? 'уточнение не получено' };
  }

  const byTopic = new Map(withLesson.map((candidate) => [candidate.topicId, candidate]));
  const items = outcome.items
    .map((item) => {
      const candidate = byTopic.get(item.topicId);
      return candidate?.lessonId == null
        ? null
        : {
            position: item.position,
            kind: item.kind,
            topic_id: item.topicId,
            subject_id: candidate.subjectId,
            title: item.title,
            meta: item.meta === '' ? itemMeta(item.estMinutes, null) : item.meta,
            est_minutes: item.estMinutes,
            lesson_id: candidate.lessonId,
          };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (items.length === 0) {
    return { applied: false, reason: 'после сверки не осталось пунктов' };
  }

  return ctx.applyOnce(async (tx) => {
    
    
    const [started] = await tx<{ count: string }[]>`
      select count(*) as count
        from public.daily_plan_items
       where plan_id = ${plan.id} and status <> 'pending'
    `;

    if (Number(started?.count ?? 0) > 0) {
      const skipped: JsonObject = { applied: false, reason: 'план начат во время уточнения' };
      return skipped;
    }

    await tx`delete from public.daily_plan_items where plan_id = ${plan.id}`;

    await tx`
      insert into public.daily_plan_items (
        plan_id, position, kind, topic_id, subject_id, title, meta, est_minutes, lesson_id
      )
      select ${plan.id}, p.position, p.kind, p.topic_id::uuid, p.subject_id::uuid,
             p.title, p.meta, p.est_minutes, p.lesson_id::uuid
        from jsonb_to_recordset(${tx.json(items)}) as p(
          position smallint, kind text, topic_id text, subject_id text,
          title text, meta text, est_minutes smallint, lesson_id text
        )
    `;

    await tx`
      update public.daily_plans
         set source = 'ai', ai_job_id = ${ctx.job.id}
       where id = ${plan.id}
    `;

    const result: JsonObject = {
      applied: true,
      items: items.length,
      rejected: outcome.rejected,
      rationale: outcome.rationale,
    };

    return result;
  });
};
