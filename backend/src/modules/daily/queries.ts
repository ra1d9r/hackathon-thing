import { z } from 'zod';

import type { SqlExecutor } from '../../db/sql.js';
import type { DailyCandidate, DailyItemKind } from '../../domain/daily.js';

const itemKindSchema = z.enum(['task', 'lesson', 'review']).catch('task');

export async function loadDailyCandidates(
  sql: SqlExecutor,
  studentId: string,
  gradeMin: number,
  gradeMax: number,
): Promise<DailyCandidate[]> {
  const rows = await sql<
    {
      topic_id: string;
      subject_id: string;
      title_ru: string;
      mastery_pct: string | null;
      priority: string | null;
      lesson_id: string | null;
      node_position: number | null;
      node_status: string | null;
      days_since_practice: string | null;
    }[]
  >`
    select t.id as topic_id, t.subject_id, t.title_ru,
           m.mastery_pct, m.priority,
           (
             select l.id from public.lessons l
              where l.topic_id = t.id and l.is_active
              order by l.origin = 'curated' desc, l.created_at, l.id
              limit 1
           ) as lesson_id,
           n.position as node_position,
           n.status::text as node_status,
           (
             select extract(day from now() - max(e.created_at))
               from public.stat_events e
              where e.student_id = ${studentId} and e.topic_id = t.id
           ) as days_since_practice
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
      join public.topics t on t.subject_id = s.id
      left join public.student_topic_mastery m
             on m.topic_id = t.id and m.student_id = ${studentId}
      left join public.roadmap_nodes n on n.topic_id = t.id
       and n.roadmap_id in (
         select r.id from public.roadmaps r
          where r.student_id = ${studentId} and r.is_active
       )
     where ss.student_id = ${studentId}
       and ss.removed_at is null
       and s.is_active
       and t.is_active
       and t.grade_min <= ${gradeMax}::int
       and t.grade_max >= ${gradeMin}::int
     order by coalesce(m.priority, 0) desc, s.sort_order, t.sort_order, t.id
  `;

  return rows.map((row) => ({
    topicId: row.topic_id,
    subjectId: row.subject_id,
    title: row.title_ru,
    masteryPct: Number(row.mastery_pct ?? 0),
    priority: Number(row.priority ?? 0),
    lessonId: row.lesson_id,
    nodePosition: row.node_position,
    nodeAvailable: row.node_status === 'available' || row.node_status === 'in_progress',
    daysSincePractice:
      row.days_since_practice === null ? null : Math.floor(Number(row.days_since_practice)),
  }));
}

export interface PlanItemRow {
  readonly id: string;
  readonly position: number;
  readonly kind: DailyItemKind;
  readonly topicId: string;
  readonly subjectId: string | null;
  readonly subjectName: string | null;
  readonly title: string;
  readonly meta: string | null;
  readonly estMinutes: number | null;
  readonly lessonId: string | null;
  readonly assessmentId: string | null;
  readonly attemptId: string | null;
  readonly status: string;
  readonly completedAt: string | null;
}

export interface PlanRow {
  readonly id: string;
  readonly planDate: string;
  readonly timezone: string;
  readonly source: 'ai' | 'fallback';
  readonly generatedAt: string;
  readonly items: PlanItemRow[];
}

export async function loadPlan(
  sql: SqlExecutor,
  studentId: string,
  planDate: string,
): Promise<PlanRow | null> {
  const [plan] = await sql<
    { id: string; plan_date: Date; timezone: string; source: string; generated_at: Date }[]
  >`
    select id, plan_date, timezone, source, generated_at
      from public.daily_plans
     where student_id = ${studentId} and plan_date = ${planDate}::date
  `;

  if (plan === undefined) {
    return null;
  }

  const items = await sql<
    {
      id: string;
      position: number;
      kind: string;
      topic_id: string;
      subject_id: string | null;
      subject_name: string | null;
      title: string;
      meta: string | null;
      est_minutes: number | null;
      lesson_id: string | null;
      assessment_id: string | null;
      attempt_id: string | null;
      status: string;
      completed_at: Date | null;
    }[]
  >`
    select i.id, i.position, i.kind, i.topic_id, i.subject_id,
           s.name_ru as subject_name, i.title, i.meta, i.est_minutes,
           i.lesson_id, i.assessment_id, i.attempt_id,
           i.status::text as status, i.completed_at
      from public.daily_plan_items i
      left join public.subjects s on s.id = i.subject_id
     where i.plan_id = ${plan.id}
     order by i.position, i.id
  `;

  return {
    id: plan.id,
    planDate: plan.plan_date.toISOString().slice(0, 10),
    timezone: plan.timezone,
    source: plan.source === 'ai' ? 'ai' : 'fallback',
    generatedAt: plan.generated_at.toISOString(),
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      kind: itemKindSchema.parse(item.kind),
      topicId: item.topic_id,
      subjectId: item.subject_id,
      subjectName: item.subject_name,
      title: item.title,
      meta: item.meta,
      estMinutes: item.est_minutes,
      lessonId: item.lesson_id,
      assessmentId: item.assessment_id,
      attemptId: item.attempt_id,
      status: item.status,
      completedAt: item.completed_at?.toISOString() ?? null,
    })),
  };
}

export interface StorePlanInput {
  readonly studentId: string;
  readonly planDate: string;
  readonly timezone: string;
  readonly source: 'ai' | 'fallback';
  readonly aiJobId: string | null;
  readonly items: readonly {
    readonly position: number;
    readonly kind: DailyItemKind;
    readonly topicId: string;
    readonly subjectId: string;
    readonly title: string;
    readonly meta: string;
    readonly estMinutes: number;
    readonly lessonId: string;
  }[];
}

export interface AppendItemInput {
  readonly position: number;
  readonly kind: DailyItemKind;
  readonly topicId: string;
  readonly subjectId: string | null;
  readonly title: string;
  readonly meta: string | null;
  readonly estMinutes: number | null;
  readonly lessonId: string | null;
}

export async function appendPlanItem(
  sql: SqlExecutor,
  planId: string,
  item: AppendItemInput,
): Promise<void> {
  await sql`
    insert into public.daily_plan_items (
      plan_id, position, kind, topic_id, subject_id, title, meta, est_minutes, lesson_id
    ) values (
      ${planId}, ${item.position}, ${item.kind}::public.daily_item_kind, ${item.topicId},
      ${item.subjectId}, ${item.title}, ${item.meta}, ${item.estMinutes}, ${item.lessonId}
    )
  `;
}

export async function storePlan(
  sql: SqlExecutor,
  input: StorePlanInput,
): Promise<string | null> {
  const [plan] = await sql<{ id: string }[]>`
    insert into public.daily_plans (student_id, plan_date, timezone, source, ai_job_id)
    values (
      ${input.studentId}, ${input.planDate}::date, ${input.timezone},
      ${input.source}, ${input.aiJobId}
    )
    on conflict (student_id, plan_date) do nothing
    returning id
  `;

  if (plan === undefined) {
    return null;
  }

  const payload = input.items.map((item) => ({
    position: item.position,
    kind: item.kind,
    topic_id: item.topicId,
    subject_id: item.subjectId,
    title: item.title,
    meta: item.meta,
    est_minutes: item.estMinutes,
    lesson_id: item.lessonId,
  }));

  await sql`
    insert into public.daily_plan_items (
      plan_id, position, kind, topic_id, subject_id, title, meta, est_minutes, lesson_id
    )
    select ${plan.id}, p.position, p.kind, p.topic_id::uuid, p.subject_id::uuid,
           p.title, p.meta, p.est_minutes, p.lesson_id::uuid
      from jsonb_to_recordset(${sql.json(payload)}) as p(
        position smallint, kind text, topic_id text, subject_id text,
        title text, meta text, est_minutes smallint, lesson_id text
      )
  `;

  return plan.id;
}
