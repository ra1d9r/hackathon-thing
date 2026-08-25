alter table public.profiles   drop constraint if exists profiles_grade_check;
alter table public.topics     drop constraint if exists topics_grade_min_check;
alter table public.topics     drop constraint if exists topics_grade_max_check;
alter table public.materials  drop constraint if exists materials_grade_min_check;
alter table public.materials  drop constraint if exists materials_grade_max_check;
alter table public.assessments drop constraint if exists assessments_grade_check;
alter table public.questions  drop constraint if exists questions_grade_check;
alter table public.lessons    drop constraint if exists lessons_grade_min_check;
alter table public.lessons    drop constraint if exists lessons_grade_max_check;
alter table public.classes    drop constraint if exists classes_grade_check;

alter table public.profiles
  add constraint profiles_grade_check check (grade between 5 and 11);
alter table public.topics
  add constraint topics_grade_min_check check (grade_min between 5 and 11),
  add constraint topics_grade_max_check check (grade_max between 5 and 11);
alter table public.materials
  add constraint materials_grade_min_check check (grade_min between 5 and 11),
  add constraint materials_grade_max_check check (grade_max between 5 and 11);
alter table public.assessments
  add constraint assessments_grade_check check (grade between 5 and 11);
alter table public.questions
  add constraint questions_grade_check check (grade between 5 and 11);
alter table public.lessons
  add constraint lessons_grade_min_check check (grade_min between 5 and 11),
  add constraint lessons_grade_max_check check (grade_max between 5 and 11);
alter table public.classes
  add constraint classes_grade_check check (grade between 5 and 11);

alter table public.materials
  add column if not exists ai_text text;

comment on column public.materials.ai_text is
  'Плоское представление материала для модели. NULL означает «в контекст модели не давать»: '
  'скан страницы учебника показать ученику можно, а подставить в промпт — нечего.';

comment on column public.materials.body_md is
  'Человеческое представление: то, что читает ученик. Может быть подписью к скану или фотографии.';

create table public.exam_profile_pairs (
  id              uuid primary key default gen_random_uuid(),
  exam_profile_id uuid not null references public.exam_profiles(id) on delete cascade,
  subject_a_id    uuid not null references public.subjects(id) on delete cascade,
  subject_b_id    uuid not null references public.subjects(id) on delete cascade,
  sort_order      smallint not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint exam_profile_pairs_ordered check (subject_a_id < subject_b_id)
);

create unique index exam_profile_pairs_unique_idx
  on public.exam_profile_pairs(exam_profile_id, subject_a_id, subject_b_id);

create index exam_profile_pairs_exam_idx
  on public.exam_profile_pairs(exam_profile_id) where is_active;

comment on table public.exam_profile_pairs is
  'Утверждённые пары профильных предметов экзамена. Пустой список означает «любая пара разрешена».';

alter table public.exam_profile_pairs enable row level security;
alter table public.exam_profile_pairs force row level security;

create policy exam_profile_pairs_read on public.exam_profile_pairs
  for select to authenticated using (is_active);

grant select on public.exam_profile_pairs to authenticated;
grant all on public.exam_profile_pairs to service_role;
