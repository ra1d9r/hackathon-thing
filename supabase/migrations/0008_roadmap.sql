create table public.lessons (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  topic_id    uuid not null references public.topics(id) on delete cascade,
  title       text not null,
  material_id uuid references public.materials(id) on delete set null,
  outline     jsonb not null default '[]'::jsonb,
  grade_min   smallint check (grade_min between 7 and 12),
  grade_max   smallint check (grade_max between 7 and 12),
  origin      text not null default 'curated' check (origin in ('curated','ai','teacher')),
  created_by  uuid references public.profiles(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on column public.lessons.outline is
  'Состав урока, показываемый до начала: [{"step":1,"kind":"intro","title":"Интро"}, ...].';

create index lessons_topic_idx on public.lessons(topic_id) where is_active;

alter table public.assessments
  add constraint assessments_lesson_fk
  foreign key (lesson_id) references public.lessons(id) on delete set null;

create table public.lesson_progress (
  student_id       uuid not null references public.profiles(id) on delete cascade,
  lesson_id        uuid not null references public.lessons(id) on delete cascade,
  progress_pct     numeric(5,2) not null default 0 check (progress_pct between 0 and 100),
  material_read_at timestamptz,
  check_attempt_id uuid references public.attempts(id) on delete set null,
  best_check_pct   numeric(5,2) check (best_check_pct between 0 and 100),
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),

  primary key (student_id, lesson_id)
);

comment on column public.lesson_progress.progress_pct is
  'Чтение материала даёт 30%, результат проверки знаний — остальные 70%.';

create trigger lesson_progress_touch
  before update on public.lesson_progress
  for each row execute function app.touch_updated_at();


create table public.roadmaps (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles(id) on delete cascade,
  subject_id   uuid not null references public.subjects(id) on delete cascade,
  version      integer not null default 1,
  is_active    boolean not null default true,
  generated_at timestamptz not null default now(),
  ai_job_id    uuid,
  rationale    text
);

create unique index roadmaps_active_idx
  on public.roadmaps(student_id, subject_id) where is_active;

create index roadmaps_student_idx on public.roadmaps(student_id);

create table public.roadmap_nodes (
  id           uuid primary key default gen_random_uuid(),
  roadmap_id   uuid not null references public.roadmaps(id) on delete cascade,
  position     smallint not null check (position >= 1),
  topic_id     uuid not null references public.topics(id) on delete restrict,
  lesson_id    uuid references public.lessons(id) on delete set null,
  material_id  uuid references public.materials(id) on delete set null,
  title        text not null,
  outline      jsonb not null default '[]'::jsonb,
  status       public.roadmap_node_status not null default 'locked',
  progress_pct numeric(5,2) not null default 0 check (progress_pct between 0 and 100),
  unlock_rule  jsonb not null default '{"kind":"sequential"}'::jsonb,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),

  constraint roadmap_nodes_position_unique
    unique (roadmap_id, position) deferrable initially deferred
);

create index roadmap_nodes_order_idx on public.roadmap_nodes(roadmap_id, position);

create trigger roadmap_nodes_touch
  before update on public.roadmap_nodes
  for each row execute function app.touch_updated_at();

create table public.daily_plans (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles(id) on delete cascade,
  plan_date    date not null,
  timezone     text not null,
  generated_at timestamptz not null default now(),
  ai_job_id    uuid,
  source       text not null default 'ai' check (source in ('ai','fallback')),

  constraint daily_plans_unique unique (student_id, plan_date)
);

comment on column public.daily_plans.plan_date is
  'Локальная дата ученика на момент создания плана, по profiles.timezone.';

create table public.daily_plan_items (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.daily_plans(id) on delete cascade,
  position      smallint not null check (position between 1 and 6),
  kind          text not null check (kind in ('task','lesson','review')),
  topic_id      uuid not null references public.topics(id) on delete restrict,
  subject_id    uuid not null references public.subjects(id) on delete restrict,
  title         text not null,
  meta          text,
  est_minutes   smallint check (est_minutes between 1 and 240),
  assessment_id uuid references public.assessments(id) on delete set null,
  lesson_id     uuid references public.lessons(id) on delete set null,
  attempt_id    uuid references public.attempts(id) on delete set null,
  status        public.daily_item_status not null default 'pending',
  completed_at  timestamptz,

  constraint daily_items_position_unique unique (plan_id, position),
  constraint daily_items_target check (assessment_id is not null or lesson_id is not null)
);

create index daily_plan_items_plan_idx on public.daily_plan_items(plan_id, position);

create table public.student_streaks (
  student_id          uuid primary key references public.profiles(id) on delete cascade,
  current_streak      integer not null default 0 check (current_streak >= 0),
  longest_streak      integer not null default 0 check (longest_streak >= 0),
  last_completed_date date,
  updated_at          timestamptz not null default now(),

  constraint streak_longest_covers_current check (longest_streak >= current_streak)
);

comment on column public.student_streaks.last_completed_date is
  'Защита от повторного засчитывания: та же дата второй раз серию не увеличивает.';

create trigger student_streaks_touch
  before update on public.student_streaks
  for each row execute function app.touch_updated_at();
