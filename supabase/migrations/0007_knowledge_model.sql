create table public.stat_events (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.profiles(id) on delete cascade,
  topic_id        uuid not null references public.topics(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  source_type     public.stat_source_type not null,
  source_id       uuid,
  delta_pct       numeric(5,2) not null check (delta_pct between -25 and 25),
  baseline_pct    numeric(5,2) check (baseline_pct between 0 and 100),
  observed_pct    numeric(5,2) check (observed_pct between 0 and 100),
  evidence_weight numeric(3,2) not null default 1.00
                  check (evidence_weight > 0 and evidence_weight <= 1),
  reason          text not null check (char_length(reason) <= 300),
  ai_job_id       uuid,
  created_at      timestamptz not null default now()
);

comment on table public.stat_events is
  'Append-only журнал изменений мастерства. Единственный легальный вход в модель знаний.';
comment on column public.stat_events.delta_pct is
  'Уже ограниченная дельта. Границы контракта ИИ и здесь совпадают: +/-25.';
comment on column public.stat_events.baseline_pct is
  'Стартовое значение для самого первого свидетельства по теме.';

create unique index stat_events_dedupe_idx
  on public.stat_events(student_id, source_type, source_id, topic_id)
  where source_id is not null;

create index stat_events_student_time_idx
  on public.stat_events(student_id, created_at desc);

create table public.student_topic_mastery (
  student_id        uuid not null references public.profiles(id) on delete cascade,
  topic_id          uuid not null references public.topics(id) on delete cascade,
  subject_id        uuid not null references public.subjects(id) on delete cascade,
  mastery_pct       numeric(5,2) not null default 0 check (mastery_pct between 0 and 100),
  confidence        numeric(3,2) not null default 0 check (confidence between 0 and 1),
  evidence_count    integer not null default 0 check (evidence_count >= 0),
  priority          numeric(6,4) not null default 0 check (priority >= 0),
  status            public.mastery_status not null default 'unknown',

  is_problem        boolean generated always as (
                      mastery_pct < 100 and status in ('weak','improving')
                    ) stored,

  first_evidence_at timestamptz,
  last_evidence_at  timestamptz,
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,

  primary key (student_id, topic_id)
);

create index stm_problem_idx
  on public.student_topic_mastery(student_id, priority desc) where is_problem;
create index stm_subject_idx
  on public.student_topic_mastery(student_id, subject_id);

create table public.student_subject_mastery (
  student_id      uuid not null references public.profiles(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  mastery_pct     numeric(5,2) not null default 0 check (mastery_pct between 0 and 100),
  topics_total    integer not null default 0,
  topics_mastered integer not null default 0,
  updated_at      timestamptz not null default now(),

  primary key (student_id, subject_id)
);

create or replace function app.recompute_subject_mastery(p_student uuid, p_subject uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.student_subject_mastery as s
    (student_id, subject_id, mastery_pct, topics_total, topics_mastered, updated_at)
  select
    p_student,
    p_subject,
    coalesce(
      round(
        sum(m.mastery_pct * coalesce(t.exam_weight, 1))
        / nullif(sum(coalesce(t.exam_weight, 1)), 0),
        2),
      0),
    count(*),
    count(*) filter (where m.status = 'mastered'),
    now()
  from public.student_topic_mastery m
  join public.topics t on t.id = m.topic_id
  where m.student_id = p_student and m.subject_id = p_subject
  on conflict (student_id, subject_id) do update set
    mastery_pct     = excluded.mastery_pct,
    topics_total    = excluded.topics_total,
    topics_mastered = excluded.topics_mastered,
    updated_at      = now();
end $$;

comment on function app.recompute_subject_mastery(uuid, uuid) is
  'Пересобирает мастерство по предмету как среднее по темам, взвешенное экзаменационным весом.';


create or replace function app.apply_stat_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prev_row   public.student_topic_mastery%rowtype;
  prev_pct   numeric(5,2);
  new_pct    numeric(5,2);
  new_conf   numeric(3,2);
  new_count  integer;
  topic_w    numeric(4,2);
  new_status public.mastery_status;
  new_prio   numeric(6,4);
begin
  select * into prev_row
    from public.student_topic_mastery
   where student_id = new.student_id and topic_id = new.topic_id
     for update;

  prev_pct  := coalesce(prev_row.mastery_pct, new.baseline_pct, 0);
  new_count := coalesce(prev_row.evidence_count, 0) + 1;
  new_pct   := least(100, greatest(0, prev_pct + new.delta_pct));

  new_conf := round(
    ((coalesce(prev_row.confidence, 0) * coalesce(prev_row.evidence_count, 0))
      + new.evidence_weight) / new_count,
    2);
  new_conf := least(1.00, greatest(0.00, new_conf));

  new_status := case
    when new_pct >= 100 then 'mastered'
    when new_pct <  40  then 'weak'
    when new_pct <  70  then 'improving'
    else 'strong'
  end;

  select coalesce(t.exam_weight, 1.00) into topic_w
    from public.topics t where t.id = new.topic_id;

  new_prio := case
    when new_status = 'mastered' then 0
    else round(((100 - new_pct) / 100.0) * topic_w * (1.5 - 0.5 * new_conf), 4)
  end;

  insert into public.student_topic_mastery as m (
    student_id, topic_id, subject_id, mastery_pct, confidence, evidence_count,
    priority, status, first_evidence_at, last_evidence_at, updated_at, version
  ) values (
    new.student_id, new.topic_id, new.subject_id, new_pct, new_conf, new_count,
    new_prio, new_status, new.created_at, new.created_at, now(), 1
  )
  on conflict (student_id, topic_id) do update set
    mastery_pct      = excluded.mastery_pct,
    confidence       = excluded.confidence,
    evidence_count   = excluded.evidence_count,
    priority         = excluded.priority,
    status           = excluded.status,
    last_evidence_at = excluded.last_evidence_at,
    updated_at       = now(),
    version          = m.version + 1;

  perform app.recompute_subject_mastery(new.student_id, new.subject_id);
  return new;
end $$;

comment on function app.apply_stat_event() is
  'Пересчитывает проекцию мастерства по событию журнала. Единственное место изменения mastery_pct.';

create trigger stat_events_apply
  after insert on public.stat_events
  for each row execute function app.apply_stat_event();

create or replace function app.refresh_priorities() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  affected integer;
begin
  update public.student_topic_mastery m
     set priority = round(
           ((100 - m.mastery_pct) / 100.0)
           * coalesce(t.exam_weight, 1.00)
           * (1.5 - 0.5 * m.confidence)
           * (1 + least(0.5, extract(epoch from (now() - coalesce(m.last_evidence_at, now())))
                              / 86400.0 / 30.0)),
           4),
         updated_at = now()
    from public.topics t
   where t.id = m.topic_id
     and m.status <> 'mastered';

  get diagnostics affected = row_count;
  return affected;
end $$;


create table public.mastery_snapshots (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  taken_at   timestamptz not null default now(),
  reason     text not null,
  payload    jsonb not null
);

comment on table public.mastery_snapshots is
  'Срезы мастерства в ключевые моменты: диагностика, пробник, перепланирование.';

create index mastery_snapshots_student_idx
  on public.mastery_snapshots(student_id, taken_at desc);

create table public.predicted_scores (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.profiles(id) on delete cascade,
  exam_profile_id uuid references public.exam_profiles(id) on delete set null,
  scale_kind      text not null check (scale_kind in ('points','ten')),
  value           numeric(6,2) not null check (value >= 0),
  baseline_value  numeric(6,2) not null check (baseline_value >= 0),
  max_value       numeric(6,2) not null check (max_value > 0),
  confidence      numeric(3,2) not null default 0.5 check (confidence between 0 and 1),
  breakdown       jsonb not null default '{}'::jsonb,
  source          text not null check (source in ('ai','baseline')),
  ai_job_id       uuid,
  computed_at     timestamptz not null default now(),

  constraint predicted_scores_within_max check (value <= max_value)
);

comment on column public.predicted_scores.baseline_value is
  'Детерминированная оценка. Значение от ИИ ограничивается коридором baseline +/-10% шкалы.';

create index predicted_scores_student_idx
  on public.predicted_scores(student_id, computed_at desc);


create table public.study_sessions (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  context    text not null check (context in ('lesson','task','mock','diagnostic','assistant')),
  ref_id     uuid,
  started_at timestamptz not null,
  ended_at   timestamptz,
  seconds    integer not null default 0 check (seconds >= 0 and seconds <= 43200),
  created_at timestamptz not null default now()
);

comment on column public.study_sessions.seconds is
  'Верхняя граница в 12 часов отсекает забытую открытой вкладку.';

create index study_sessions_student_idx
  on public.study_sessions(student_id, started_at desc);
