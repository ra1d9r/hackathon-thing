import type { DashboardResponse } from '../../contracts/dto/dashboard.js';
import { learningGoalSchema, masteryStatusSchema, roundTo, tenToFiveGrade } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import { localDate } from '../../domain/day.js';
import { nextFatigue, pickFocus, type FocusCandidate } from '../../domain/focus.js';
import type { AuthUser } from '../../types/fastify.js';
import { loadScoreContext, storePredictedScore } from '../stats/score.js';

const CRITICAL_GAP_PCT = 20;

interface GoalRow {
  goal: string;
  target_date: Date | null;
  exam_title: string | null;
  onboarding_completed_at: Date | null;
}

interface TopicRow {
  topic_id: string;
  topic_title: string;
  subject_code: string;
  subject_name: string;
  mastery_pct: string;
  confidence: string;
  priority: string;
  status: string;
  focus_fatigue: number;
  last_focus_date: Date | null;
}

interface ActivityRow {
  questions_answered: string;
  attempts_graded: string;
  study_seconds: string;
}

interface ScoreRow {
  value: string;
  baseline_value: string;
  max_value: string;
  scale_kind: string;
  confidence: string;
  source: string;
  computed_at: Date;
}

function goalTitle(goal: string, examTitle: string | null): string {
  if (examTitle !== null) {
    return examTitle;
  }
  return goal === 'subjects' ? 'Подтянуть предметы' : goal.toUpperCase();
}

function daysUntil(target: Date | null): number | null {
  if (target === null) {
    return null;
  }
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86_400_000));
}

function toWeakTopic(row: TopicRow): DashboardResponse['analytics']['weak_topics'][number] {
  return {
    topic_id: row.topic_id,
    title: row.topic_title,
    subject_code: row.subject_code,
    subject_name: row.subject_name,
    mastery_pct: Number(row.mastery_pct),
    confidence: Number(row.confidence),
    priority: Number(row.priority),
    status: masteryStatusSchema.parse(row.status),
  };
}

function criticalTopic(
  topics: readonly TopicRow[],
): DashboardResponse['analytics']['critical_topic'] {
  if (topics.length < 2) {
    return null;
  }

  const sorted = [...topics].sort(
    (left, right) => Number(left.mastery_pct) - Number(right.mastery_pct),
  );
  const worst = sorted[0];
  const rest = sorted.slice(1);

  if (worst === undefined || rest.length === 0) {
    return null;
  }

  const average =
    rest.reduce((sum, row) => sum + Number(row.mastery_pct), 0) / rest.length;

  return average - Number(worst.mastery_pct) >= CRITICAL_GAP_PCT ? toWeakTopic(worst) : null;
}

function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

async function recordFocus(
  sql: SqlExecutor,
  studentId: string,
  candidates: readonly TopicRow[],
  pickedIds: ReadonlySet<string>,
  planDate: string,
): Promise<void> {
  const changed = candidates
    .map((row) => {
      const last = isoDate(row.last_focus_date);
      const picked = pickedIds.has(row.topic_id);
      const next = nextFatigue(row.focus_fatigue, last, planDate, picked);
      return { topicId: row.topic_id, next, picked, last };
    })
    .filter((item) => item.next !== 0 || item.last !== null);

  if (changed.length === 0) {
    return;
  }

  await sql`
    update public.student_topic_mastery m
       set focus_fatigue = item.fatigue::smallint,
           last_focus_date = case when item.picked = 'true' then ${planDate}::date
                                  else m.last_focus_date end
      from unnest(
             ${changed.map((item) => item.topicId)}::text[],
             ${changed.map((item) => String(item.next))}::text[],
             ${changed.map((item) => String(item.picked))}::text[]
           ) as item(topic_id, fatigue, picked)
     where m.student_id = ${studentId}
       and m.topic_id = item.topic_id::uuid
  `;
}

export async function buildDashboard(sql: Sql, user: AuthUser): Promise<DashboardResponse> {
  const [profile] = await sql<GoalRow[]>`
    select sp.goal::text as goal, sp.target_date, sp.onboarding_completed_at,
           e.title_ru as exam_title
      from public.student_profiles sp
      left join public.exam_profiles e on e.id = sp.target_exam_id
     where sp.student_id = ${user.id}
  `;

  if (profile?.onboarding_completed_at == null) {
    throw new AppError('ONBOARDING_INCOMPLETE');
  }

  const [timezoneRow] = await sql<{ timezone: string }[]>`
    select timezone from public.profiles where id = ${user.id}
  `;
  const planDate = localDate(timezoneRow?.timezone ?? 'UTC');

  const [topics, activity, latestScores, plan, streak, mocks, pending] = await Promise.all([
    sql<TopicRow[]>`
      select m.topic_id, t.title_ru as topic_title, s.code as subject_code,
             s.name_ru as subject_name, m.mastery_pct, m.confidence, m.priority,
             m.status::text as status, m.focus_fatigue, m.last_focus_date
        from public.student_topic_mastery m
        join public.topics t on t.id = m.topic_id
        join public.subjects s on s.id = m.subject_id
       where m.student_id = ${user.id} and m.is_problem
       -- Приоритеты совпадают сплошь и рядом: после диагностики у половины
       -- тем одно и то же значение. Без доопределения порядка Postgres
       -- вправе вернуть их как угодно — и список слабых тем менялся бы
       -- при каждом обновлении экрана, а отпечаток ответа не совпадал бы
       -- никогда.
       order by m.priority desc, t.title_ru, m.topic_id
    `,
    sql<ActivityRow[]>`
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
      {
        id: string;
        title: string;
        meta: string | null;
        subject_name: string | null;
        status: string;
        kind: string;
        plan_date: Date;
      }[]
    >`
      select i.id, i.title, i.meta, s.name_ru as subject_name,
             i.status::text as status, i.kind, p.plan_date
        from public.daily_plans p
        join public.daily_plan_items i on i.plan_id = p.id
        left join public.subjects s on s.id = i.subject_id
       where p.student_id = ${user.id} and p.plan_date = ${planDate}::date
       order by i.position, i.id
    `,
    sql<{ current_streak: number; longest_streak: number; last_completed_date: Date | null }[]>`
      select current_streak, longest_streak, last_completed_date
        from public.student_streaks where student_id = ${user.id}
    `,
    sql<
      { id: string; title: string; question_count: number; time_limit_sec: number | null; attempted: boolean }[]
    >`
      select a.id, a.title, a.time_limit_sec,
             (select count(*) from public.assessment_questions aq
               where aq.assessment_id = a.id)::int as question_count,
             exists (
               select 1 from public.attempts at
                where at.assessment_id = a.id and at.student_id = ${user.id}
                  and at.status <> 'abandoned'
             ) as attempted
        from public.assessments a
        join public.student_profiles sp on sp.student_id = ${user.id}
       where a.kind = 'exam_mock' and a.is_active
         and (a.exam_profile_id is null or a.exam_profile_id = sp.target_exam_id)
       order by a.created_at, a.id
       limit 3
    `,
    sql<{ n: number }[]>`
      select count(*)::int as n from public.ai_jobs
       where student_id = ${user.id}
         and status in ('queued','running','awaiting_retry')
    `,
    
    

  ]);

  const scoreHistoryRows = await sql<{ computed_at: Date; value: string }[]>`
    select computed_at, value from public.predicted_scores
     where student_id = ${user.id}
     order by computed_at, id
     limit 60
  `;

  
  const candidates: FocusCandidate[] = topics.map((row) => ({
    topicId: row.topic_id,
    priority: Number(row.priority),
    focusFatigue: row.focus_fatigue,
  }));

  
  
  
  const decidedToday = topics.filter((row) => isoDate(row.last_focus_date) === planDate);

  const pickedIds =
    decidedToday.length > 0
      ? new Set(decidedToday.map((row) => row.topic_id))
      : new Set(pickFocus(candidates, user.id, planDate).map((item) => item.topicId));

  if (decidedToday.length === 0) {
    await recordFocus(sql, user.id, topics, pickedIds, planDate);
  }

  const todayFocus = topics
    .filter((row) => pickedIds.has(row.topic_id))
    .map((row) => ({
      topic_id: row.topic_id,
      title: row.topic_title,
      subject_code: row.subject_code,
      subject_name: row.subject_name,
      mastery_pct: Number(row.mastery_pct),
      priority: Number(row.priority),
      status: masteryStatusSchema.parse(row.status),
    }));

  
  const [latest, previous] = latestScores;
  let predicted: DashboardResponse['predicted_score'] = null;

  if (latest !== undefined) {
    const value = Number(latest.value);
    predicted = {
      scale: latest.scale_kind === 'ten' ? 'ten' : 'points',
      value,
      max: Number(latest.max_value),
      five_grade: latest.scale_kind === 'ten' ? tenToFiveGrade(value) : null,
      confidence: Number(latest.confidence),
      baseline_value: Number(latest.baseline_value),
      delta_vs_previous:
        previous === undefined ? null : roundTo(value - Number(previous.value), 2),
      computed_at: latest.computed_at.toISOString(),
      source: latest.source === 'ai' ? 'ai' : 'baseline',
    };
  } else {
    
    
    
    const context = await loadScoreContext(sql, user.id);
    if (context !== null) {
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

      predicted = {
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
  }

  const counters = activity[0];
  const streakRow = streak[0];
  const completed = plan.filter((item) => item.status === 'completed').length;

  return {
    goal: {
      kind: learningGoalSchema.parse(profile.goal),
      title: goalTitle(profile.goal, profile.exam_title),
      target_date: profile.target_date?.toISOString().slice(0, 10) ?? null,
      days_left: daysUntil(profile.target_date),
    },
    predicted_score: predicted,
    today_focus: todayFocus,
    daily_plan: {
      date: planDate,
      completed,
      total: plan.length,
      items: plan.map((item) => ({
        id: item.id,
        title: item.title,
        meta: item.meta ?? '',
        subject_name: item.subject_name,
        status:
          item.status === 'in_progress' || item.status === 'completed' || item.status === 'skipped'
            ? item.status
            : 'pending',
        kind: item.kind,
      })),
      empty_reason: plan.length === 0 ? 'not_generated_yet' : null,
    },
    streak: {
      current: streakRow?.current_streak ?? 0,
      longest: streakRow?.longest_streak ?? 0,
      today_completed:
        streakRow?.last_completed_date?.toISOString().slice(0, 10) === planDate,
    },
    analytics: {
      questions_answered: Number(counters?.questions_answered ?? 0),
      attempts_graded: Number(counters?.attempts_graded ?? 0),
      study_hours: roundTo(Number(counters?.study_seconds ?? 0) / 3600, 1),
      score_history: scoreHistoryRows.map((row) => ({
        at: row.computed_at.toISOString(),
        value: Number(row.value),
      })),
      weak_topics: topics.slice(0, 5).map(toWeakTopic),
      critical_topic: criticalTopic(topics),
    },
    upcoming_mocks: mocks.map((mock) => ({
      assessment_id: mock.id,
      title: mock.title,
      question_count: mock.question_count,
      time_limit_sec: mock.time_limit_sec,
      attempted: mock.attempted,
    })),
    pending_ai: { jobs: pending[0]?.n ?? 0 },
    computed_at: new Date().toISOString(),
  };
}
