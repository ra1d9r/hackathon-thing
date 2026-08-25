-- 0003 — личность пользователя: профиль, роль, неизменяемый публичный идентификатор.
--
-- Профиль создаёт backend в одной транзакции с созданием auth.users через
-- Admin API. Триггера на auth.users намеренно нет: роль должна приходить из
-- проверенного серверного контекста, а не из raw_user_meta_data, которым
-- управляет клиент (см. docs/00, AD-3).

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  role           public.user_role not null,
  public_id      text not null unique,
  display_name   text not null check (char_length(display_name) between 1 and 64),
  grade          smallint check (grade between 7 and 12),
  avatar_file_id uuid,                       -- FK добавляется в 0005
  locale         text not null default 'ru' check (locale in ('ru','kk','en')),
  timezone       text not null default 'Asia/Almaty',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1,

  constraint profiles_student_needs_grade
    check (role <> 'student' or grade is not null)
);

comment on table public.profiles is
  'Профиль пользователя. public_id и role неизменяемы после создания.';
comment on column public.profiles.public_id is
  'Публичный идентификатор вида TLK-XXXXXXXX. Учитель добавляет ученика в класс именно по нему.';

create index profiles_role_idx on public.profiles(role);

-- ─── Генерация публичного идентификатора ─────────────────────────────────────

-- Crockford Base32 без похожих символов (I, L, O, U исключены).
-- 8 знаков дают около 1e12 комбинаций — перебор бессмыслен, а прочитать
-- и продиктовать такой код человек может без ошибок.
create or replace function app.generate_public_id() returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := 'TLK-';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles p where p.public_id = candidate);
  end loop;
  return candidate;
end $$;

comment on function app.generate_public_id() is
  'Возвращает свободный публичный идентификатор пользователя.';

-- ─── Неизменяемость личности ─────────────────────────────────────────────────

-- Требование SPEC: идентификатор уникален и неизменен. Роль тоже фиксируется:
-- смена роли на лету означала бы обход авторизации.
create or replace function app.enforce_immutable_identity() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id профиля неизменяем' using errcode = '23514';
  end if;
  if new.public_id is distinct from old.public_id then
    raise exception 'public_id неизменяем' using errcode = '23514';
  end if;
  if new.role is distinct from old.role then
    raise exception 'смена роли не допускается' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger profiles_immutable_identity
  before update on public.profiles
  for each row execute function app.enforce_immutable_identity();

create trigger profiles_touch
  before update on public.profiles
  for each row execute function app.touch_updated_at();

create trigger profiles_version
  before update on public.profiles
  for each row execute function app.bump_version();

-- ─── Учебный профиль ученика ─────────────────────────────────────────────────

create table public.student_profiles (
  student_id              uuid primary key references public.profiles(id) on delete cascade,
  goal                    public.learning_goal not null,
  target_exam_id          uuid,               -- FK добавляется в 0004
  target_date             date,
  onboarding_completed_at timestamptz,
  diagnostic_attempt_id   uuid,               -- FK добавляется в 0006
  updated_at              timestamptz not null default now(),
  version                 integer not null default 1,

  -- Экзаменационная цель обязана ссылаться на чертёж экзамена, иначе
  -- прогноз балла считать не из чего; «подтягивание предметов» — наоборот.
  constraint student_goal_exam_consistency
    check (
      (goal in ('ent','nis','olympiad') and target_exam_id is not null)
      or (goal = 'subjects' and target_exam_id is null)
    )
);

create trigger student_profiles_touch
  before update on public.student_profiles
  for each row execute function app.touch_updated_at();

create trigger student_profiles_version
  before update on public.student_profiles
  for each row execute function app.bump_version();

-- Сырой снимок ответов опросника: состав вопросов со временем меняется,
-- а восстановить, что именно отвечал ученик, должно быть возможно всегда.
create table public.onboarding_answers (
  student_id     uuid primary key references public.profiles(id) on delete cascade,
  schema_version smallint not null default 1,
  answers        jsonb not null,
  completed_at   timestamptz not null default now()
);
