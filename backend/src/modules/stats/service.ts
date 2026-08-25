import type {
  ScoreHistory,
  StatsOverview,
  StatsTopics,
} from '../../contracts/dto/dashboard.js';
import { masteryStatusSchema, roundTo, tenToFiveGrade } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import { resolveTimeZone } from '../../domain/day.js';
import type { AuthUser } from '../../types/fastify.js';
import { loadScoreContext, storePredictedScore } from './score.js';

interface ScoreRow {
  value: string;
  baseline_value: string;
  max_value: string;
  scale_kind: string;
  confidence: string;
  source: string;
  computed_at: Date;
}

function toPredicted(
  latest: ScoreRow | undefined,
  previous: ScoreRow | undefined,
): StatsOverview['predicted_score'] {
  if (latest === undefined) {
    return null;
  }

  const value = Number(latest.value);

  return {
    scale: latest.scale_kind === 'ten' ? 'ten' : 'points',
    value,
    max: Number(latest.max_value),
    five_grade: latest.scale_kind === 'ten' ? tenToFiveGrade(value) : null,
    confidence: Number(latest.confidence),
    baseline_value: Number(latest.baseline_value),
    delta_vs_previous: previous === undefined ? null : roundTo(value - Number(previous.value), 2),
    computed_at: latest.computed_at.toISOString(),
    source: latest.source === 'ai' ? 'ai' : 'baseline',
  };
}

async function requireOnboarded(sql: Sql, studentId: string): Promise<void> {
  const [row] = await sql<{ onboarding_completed_at: Date | null }[]>`
    select onboarding_completed_at from public.student_profiles where student_id = ${studentId}
  `;

  if (row?.onboarding_completed_at == null) {
    throw new AppError('ONBOARDING_INCOMPLETE');
  }
}

export async function buildOverview(sql: Sql, user: AuthUser): Promise<StatsOverview> {
  await requireOnboarded(sql, user.id);

  const [activity, scores, subjects, extra] = await Promise.all([
    sql<{ questions_answered: string; attempts_graded: string; study_seconds: string }[]>`
      select questions_answered, attempts_graded, study_seconds
        from public.v_student_activity where student_id = ${user.id}
    `,
    sql<ScoreRow[]>`
      select value, baseline_value, max_value, scale_kind, confidence, source, computed_at
        from public.predicted_scores
       where student_id = ${user.id}
       order by computed_at desc, id desc
       limit 2
    `,
    sql<
      { code: string; name: string; mastery_pct: string; topics_total: number; topics_mastered: number }[]
    >`
      select s.code, s.name_ru as name, m.mastery_pct, m.topics_total, m.topics_mastered
        from public.student_subject_mastery m
        join public.subjects s on s.id = m.subject_id
       where m.student_id = ${user.id}
       order by s.sort_order, s.code
    `,
    sql<{ class_name: string | null; streak_days: number; ai_usage_count: number }[]>`
      select
        (select c.name from public.class_members cm
           join public.classes c on c.id = cm.class_id
          where cm.student_id = ${user.id} and cm.status = 'active'
          order by cm.joined_at desc limit 1) as class_name,
        coalesce((select current_streak from public.student_streaks
                   where student_id = ${user.id}), 0)::int as streak_days,
        (select count(*) from public.ai_jobs
          where student_id = ${user.id} and op_type = 'assistant_chat')::int as ai_usage_count
    `,
  ]);

  const counters = activity[0];
  const meta = extra[0];

  return {
    questions_answered: Number(counters?.questions_answered ?? 0),
    attempts_graded: Number(counters?.attempts_graded ?? 0),
    study_hours: roundTo(Number(counters?.study_seconds ?? 0) / 3600, 1),
    predicted_score: toPredicted(scores[0], scores[1]),
    subjects: subjects.map((row) => ({
      code: row.code,
      name: row.name,
      mastery_pct: Number(row.mastery_pct),
      topics_total: row.topics_total,
      topics_mastered: row.topics_mastered,
    })),
    class_name: meta?.class_name ?? null,
    streak_days: meta?.streak_days ?? 0,
    ai_usage_count: meta?.ai_usage_count ?? 0,
    computed_at: new Date().toISOString(),
  };
}

export interface TopicsFilter {
  readonly status?: string | undefined;
  readonly subjectCode?: string | undefined;
  readonly limit: number;
}

export async function buildTopics(
  sql: Sql,
  user: AuthUser,
  filter: TopicsFilter,
): Promise<StatsTopics> {
  await requireOnboarded(sql, user.id);

  const rows = await sql<
    {
      topic_id: string;
      topic_title: string;
      subject_code: string;
      subject_name: string;
      mastery_pct: string;
      confidence: string;
      priority: string;
      status: string;
    }[]
  >`
    select m.topic_id, t.title_ru as topic_title, s.code as subject_code,
           s.name_ru as subject_name, m.mastery_pct, m.confidence, m.priority,
           m.status::text as status
      from public.student_topic_mastery m
      join public.topics t on t.id = m.topic_id
      join public.subjects s on s.id = m.subject_id
     where m.student_id = ${user.id}
       and (${filter.status ?? null}::text is null
            or m.status::text = ${filter.status ?? null})
       and (${filter.subjectCode ?? null}::text is null
            or s.code = ${filter.subjectCode ?? null})
     -- Порядок доопределён до конца: одинаковые приоритеты встречаются
     -- часто, и без этого список менялся бы между двумя одинаковыми
     -- запросами, а отпечаток ответа не совпадал бы никогда.
     order by m.priority desc, m.mastery_pct asc, t.title_ru, m.topic_id
     limit ${filter.limit}
  `;

  const [any] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.student_topic_mastery where student_id = ${user.id}
  `;

  return {
    topics: rows.map((row) => ({
      topic_id: row.topic_id,
      title: row.topic_title,
      subject_code: row.subject_code,
      subject_name: row.subject_name,
      mastery_pct: Number(row.mastery_pct),
      confidence: Number(row.confidence),
      priority: Number(row.priority),
      status: masteryStatusSchema.parse(row.status),
    })),
    empty_reason:
      rows.length > 0 ? null : (any?.n ?? 0) === 0 ? 'no_evidence_yet' : 'filter_matched_nothing',
    computed_at: new Date().toISOString(),
  };
}

const RANGE_DAYS: Record<string, number | null> = { '30d': 30, '90d': 90, all: null };

export async function buildScoreHistory(
  sql: Sql,
  user: AuthUser,
  range: string,
): Promise<ScoreHistory> {
  await requireOnboarded(sql, user.id);

  const days = RANGE_DAYS[range] ?? null;

  const rows = await sql<{ computed_at: Date; value: string; max_value: string; scale_kind: string }[]>`
    select computed_at, value, max_value, scale_kind
      from public.predicted_scores
     where student_id = ${user.id}
       and (${days}::int is null
            or computed_at >= now() - make_interval(days => ${days}::int))
     order by computed_at, id
     limit 400
  `;

  const context = rows.length === 0 ? await loadScoreContext(sql, user.id) : null;

  return {
    scale: rows[0]?.scale_kind === 'ten' || context?.scale === 'ten' ? 'ten' : 'points',
    max: Number(rows[0]?.max_value ?? context?.maxScore ?? 0),
    points: rows.map((row) => ({
      at: row.computed_at.toISOString(),
      value: Number(row.value),
    })),
    computed_at: new Date().toISOString(),
  };
}

export async function getPredictedScore(
  sql: Sql,
  user: AuthUser,
): Promise<StatsOverview['predicted_score']> {
  await requireOnboarded(sql, user.id);

  const scores = await sql<ScoreRow[]>`
    select value, baseline_value, max_value, scale_kind, confidence, source, computed_at
      from public.predicted_scores
     where student_id = ${user.id}
     order by computed_at desc, id desc
     limit 2
  `;

  if (scores.length > 0) {
    return toPredicted(scores[0], scores[1]);
  }

  const context = await loadScoreContext(sql, user.id);
  if (context === null) {
    return null;
  }

  const stored = await storePredictedScore(sql, user.id, {
    context,
    value: context.baselineValue,
    source: 'baseline',
    confidence: context.confidence,
    breakdown: {
      sections: context.sections
        .filter((section) => section.subjectId !== null)
        .map((section) => ({
          subject_id: section.subjectId,
          expected_points: section.points,
          max_points: section.maxPoints,
          note: '',
        })),
    },
  });

  return {
    scale: stored.scale,
    value: stored.value,
    max: stored.maxScore,
    five_grade: stored.scale === 'ten' ? tenToFiveGrade(stored.value) : null,
    confidence: stored.confidence,
    baseline_value: stored.baselineValue,
    delta_vs_previous: null,
    computed_at: stored.computedAt,
    source: 'baseline',
  };
}

export interface HeartbeatInput {
  readonly context: 'lesson' | 'task' | 'mock' | 'diagnostic' | 'assistant';
  readonly refId: string | null;
  readonly seconds: number;
}

const MAX_DAILY_SECONDS = 43_200;

export async function recordHeartbeat(
  sql: Sql,
  user: AuthUser,
  input: HeartbeatInput,
): Promise<{ accepted_seconds: number; study_hours_today: number }> {
  const [profile] = await sql<{ timezone: string }[]>`
    select timezone from public.profiles where id = ${user.id}
  `;
  const zone = resolveTimeZone(profile?.timezone);

  const [todayRow] = await sql<{ seconds: number }[]>`
    select coalesce(sum(seconds), 0)::int as seconds
      from public.study_sessions
     where student_id = ${user.id}
       and started_at >= date_trunc('day', now() at time zone ${zone}) at time zone ${zone}
  `;

  const already = todayRow?.seconds ?? 0;
  const accepted = Math.max(0, Math.min(input.seconds, MAX_DAILY_SECONDS - already));

  if (accepted > 0) {
    await sql`
      insert into public.study_sessions (student_id, context, ref_id, started_at, ended_at, seconds)
      values (
        ${user.id}, ${input.context}, ${input.refId},
        now() - make_interval(secs => ${accepted}), now(), ${accepted}
      )
    `;
  }

  return {
    accepted_seconds: accepted,
    study_hours_today: roundTo((already + accepted) / 3600, 2),
  };
}
