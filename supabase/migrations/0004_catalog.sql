-- 0004 — учебный каталог: предметы, темы, чертежи экзаменов.
--
-- Чертёж экзамена (exam_profiles + exam_sections) — данные, а не код: формула
-- прогноза балла читает из них максимумы и веса, поэтому изменение правил ЕНТ
-- не требует правки логики (см. docs/04-domain-logic.md, §3).

create table public.subjects (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name_ru          text not null,
  name_kk          text not null,
  name_en          text not null,
  is_ent_mandatory boolean not null default false,
  sort_order       smallint not null default 100,
  is_active        boolean not null default true
);

comment on table public.subjects is 'Справочник предметов.';

-- Предметы, выбранные учеником на онбординге.
create table public.student_subjects (
  student_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  is_profile boolean not null default false,
  added_at   timestamptz not null default now(),
  removed_at timestamptz,
  primary key (student_id, subject_id)
);

comment on column public.student_subjects.is_profile is
  'Профильный предмет. Для ЕНТ их ровно два — проверяется на уровне API.';

create index student_subjects_active_idx
  on public.student_subjects(student_id) where removed_at is null;

-- ─── Темы ────────────────────────────────────────────────────────────────────

create table public.topics (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  parent_id   uuid references public.topics(id) on delete cascade,
  code        text not null,
  title_ru    text not null,
  title_kk    text,
  grade_min   smallint not null check (grade_min between 7 and 12),
  grade_max   smallint not null check (grade_max between 7 and 12),
  exam_weight numeric(4,2) not null default 1.00 check (exam_weight >= 0 and exam_weight <= 5),
  sort_order  smallint not null default 100,
  is_active   boolean not null default true,

  constraint topics_grade_range check (grade_min <= grade_max),
  constraint topics_code_unique unique (subject_id, code)
);

comment on column public.topics.exam_weight is
  'Вес темы в экзамене. Входит в приоритет темы и в агрегат мастерства по предмету.';

create index topics_subject_grade_idx
  on public.topics(subject_id, grade_min, grade_max) where is_active;
create index topics_parent_idx on public.topics(parent_id);

-- Граф предшествования: используется при построении и разблокировке roadmap.
create table public.topic_prerequisites (
  topic_id        uuid not null references public.topics(id) on delete cascade,
  prerequisite_id uuid not null references public.topics(id) on delete cascade,
  primary key (topic_id, prerequisite_id),
  constraint no_self_prerequisite check (topic_id <> prerequisite_id)
);

create index topic_prerequisites_prereq_idx on public.topic_prerequisites(prerequisite_id);

-- ─── Чертежи экзаменов ───────────────────────────────────────────────────────

create table public.exam_profiles (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  title_ru   text not null,
  scale_kind text not null check (scale_kind in ('points','ten')),
  max_score  numeric(6,2) not null check (max_score > 0),
  is_active  boolean not null default true
);

create table public.exam_sections (
  id              uuid primary key default gen_random_uuid(),
  exam_profile_id uuid not null references public.exam_profiles(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete restrict,
  slot_kind       text not null check (slot_kind in ('mandatory','profile')),
  slot_index      smallint not null default 1,
  max_points      numeric(6,2) not null check (max_points > 0),
  question_count  smallint,

  -- Доля баллов, достижимая угадыванием: у секций с выбором из пяти вариантов
  -- около 0.20, у профильных с множественным выбором ниже. Без этого нижняя
  -- граница прогноза была бы нулевой, чего на тесте с выбором не бывает.
  guess_floor     numeric(3,2) not null default 0.20
                  check (guess_floor >= 0 and guess_floor < 1),

  constraint exam_sections_unique
    unique (exam_profile_id, slot_kind, slot_index, subject_id)
);

create index exam_sections_profile_idx on public.exam_sections(exam_profile_id);

-- Отложенный внешний ключ из 0003.
alter table public.student_profiles
  add constraint student_profiles_exam_fk
  foreign key (target_exam_id) references public.exam_profiles(id) on delete set null;
