import type { SqlExecutor } from '../../db/sql.js';
import { advanceStreak, type StreakState } from '../../domain/daily.js';
import { localDate, resolveTimeZone } from '../../domain/day.js';

export async function readStreak(sql: SqlExecutor, studentId: string): Promise<StreakState> {
  const [row] = await sql<
    { current_streak: number; longest_streak: number; last_completed_date: Date | null }[]
  >`
    select current_streak, longest_streak, last_completed_date
      from public.student_streaks
     where student_id = ${studentId}
  `;

  return {
    current: row?.current_streak ?? 0,
    longest: row?.longest_streak ?? 0,
    lastCompletedDate: row?.last_completed_date?.toISOString().slice(0, 10) ?? null,
  };
}

export async function completeItemForAttempt(
  sql: SqlExecutor,
  studentId: string,
  attemptId: string,
): Promise<{ planDate: string; planCompleted: boolean } | null> {
  const [item] = await sql<{ id: string; plan_id: string; plan_date: Date }[]>`
    select i.id, i.plan_id, p.plan_date
      from public.daily_plan_items i
      join public.daily_plans p on p.id = i.plan_id
     where i.attempt_id = ${attemptId} and p.student_id = ${studentId}
     limit 1
  `;

  if (item === undefined) {
    return null;
  }

  await sql`
    update public.daily_plan_items
       set status = 'completed', completed_at = coalesce(completed_at, now())
     where id = ${item.id} and status <> 'completed'
  `;

  
  
  const [remaining] = await sql<{ count: string }[]>`
    select count(*) as count
      from public.daily_plan_items
     where plan_id = ${item.plan_id}
       and status not in ('completed', 'skipped')
  `;

  const planDate = item.plan_date.toISOString().slice(0, 10);
  const planCompleted = Number(remaining?.count ?? 0) === 0;

  if (planCompleted) {
    await bumpStreak(sql, studentId, planDate);
  }

  return { planDate, planCompleted };
}

export async function completeLessonItems(
  sql: SqlExecutor,
  studentId: string,
  lessonId: string,
): Promise<string[]> {
  const closed = await sql<{ id: string; plan_id: string; plan_date: Date }[]>`
    update public.daily_plan_items i
       set status = 'completed', completed_at = coalesce(i.completed_at, now())
      from public.daily_plans p
     where p.id = i.plan_id
       and p.student_id = ${studentId}
       and i.lesson_id = ${lessonId}
       and i.kind = 'lesson'
       and i.status not in ('completed', 'skipped')
    returning i.id, i.plan_id, p.plan_date
  `;

  for (const item of closed) {
    const [remaining] = await sql<{ count: string }[]>`
      select count(*) as count
        from public.daily_plan_items
       where plan_id = ${item.plan_id}
         and status not in ('completed', 'skipped')
    `;

    if (Number(remaining?.count ?? 0) === 0) {
      await bumpStreak(sql, studentId, item.plan_date.toISOString().slice(0, 10));
    }
  }

  return closed.map((item) => item.id);
}

export async function bumpStreak(
  sql: SqlExecutor,
  studentId: string,
  planDate: string,
): Promise<StreakState> {
  const before = await readStreak(sql, studentId);
  const after = advanceStreak(before, planDate);

  if (after.lastCompletedDate === before.lastCompletedDate && before.lastCompletedDate !== null) {
    return before;
  }

  await sql`
    insert into public.student_streaks (
      student_id, current_streak, longest_streak, last_completed_date
    ) values (
      ${studentId}, ${after.current}, ${after.longest}, ${planDate}::date
    )
    on conflict (student_id) do update set
      current_streak = excluded.current_streak,
      longest_streak = greatest(public.student_streaks.longest_streak, excluded.longest_streak),
      last_completed_date = excluded.last_completed_date
    -- Условие делает повтор безвредным на уровне запроса, а не только
    -- на уровне расчёта: два обработчика, дошедшие сюда одновременно,
    -- не увеличат серию дважды.
    where public.student_streaks.last_completed_date is distinct from excluded.last_completed_date
  `;

  return after;
}

export async function studentToday(sql: SqlExecutor, studentId: string): Promise<string> {
  const [row] = await sql<{ timezone: string }[]>`
    select timezone from public.profiles where id = ${studentId}
  `;

  return localDate(resolveTimeZone(row?.timezone));
}
