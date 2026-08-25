-- 0009 — учительская часть: классы, рассылка уроков, чат класса.
--
-- Требование SPEC: канал рассылки уроков и чат класса — разные сущности.
-- Здесь они и разведены: material_distributions против chat_channels.

create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  grade       smallint check (grade between 7 and 12),
  subject_id  uuid references public.subjects(id) on delete set null,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index classes_teacher_idx on public.classes(teacher_id) where not is_archived;

create trigger classes_touch
  before update on public.classes
  for each row execute function app.touch_updated_at();

-- Отложенный внешний ключ из 0005.
alter table public.materials
  add constraint materials_class_fk
  foreign key (class_id) references public.classes(id) on delete cascade;

create table public.class_members (
  class_id   uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status     public.membership_status not null default 'active',
  added_by   uuid references public.profiles(id) on delete set null,
  joined_at  timestamptz not null default now(),
  removed_at timestamptz,

  primary key (class_id, student_id)
);

create index class_members_student_idx
  on public.class_members(student_id) where status = 'active';

-- ─── Рассылка материалов ─────────────────────────────────────────────────────

create table public.material_distributions (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  class_id    uuid references public.classes(id) on delete cascade,
  student_id  uuid references public.profiles(id) on delete cascade,
  message_md  text check (char_length(message_md) <= 2000),
  due_at      timestamptz,
  created_at  timestamptz not null default now(),

  -- Адресат ровно один: либо класс, либо конкретный ученик.
  constraint distribution_single_target check ((class_id is null) <> (student_id is null))
);

create index distributions_class_idx
  on public.material_distributions(class_id, created_at desc);
create index distributions_student_idx
  on public.material_distributions(student_id, created_at desc);
create index distributions_teacher_idx
  on public.material_distributions(teacher_id, created_at desc);

create table public.distribution_receipts (
  distribution_id uuid not null references public.material_distributions(id) on delete cascade,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  seen_at         timestamptz,
  opened_at       timestamptz,

  primary key (distribution_id, student_id)
);

create index distribution_receipts_student_idx on public.distribution_receipts(student_id);

-- ─── Чат ─────────────────────────────────────────────────────────────────────

create table public.chat_channels (
  id         uuid primary key default gen_random_uuid(),
  kind       public.channel_kind not null,
  class_id   uuid references public.classes(id) on delete cascade,
  owner_id   uuid references public.profiles(id) on delete cascade,
  title      text not null,
  created_at timestamptz not null default now(),

  -- Чат класса привязан к классу, канал ассистента — к ученику.
  -- Смешение этих двух форм привело бы к каналу без понятного состава участников.
  constraint chat_channels_shape check (
    (kind = 'class_chat'   and class_id is not null and owner_id is null)
    or (kind = 'ai_assistant' and owner_id is not null and class_id is null)
  )
);

create unique index chat_channels_class_unique
  on public.chat_channels(class_id) where kind = 'class_chat';
create unique index chat_channels_ai_unique
  on public.chat_channels(owner_id) where kind = 'ai_assistant';

create table public.chat_channel_members (
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  joined_at    timestamptz not null default now(),

  primary key (channel_id, user_id)
);

create index chat_channel_members_user_idx on public.chat_channel_members(user_id);

create table public.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.chat_channels(id) on delete cascade,
  sender_id     uuid references public.profiles(id) on delete set null,
  sender_kind   public.sender_kind not null default 'user',
  body_md       text not null check (char_length(body_md) between 1 and 4000),
  attachments   jsonb not null default '[]'::jsonb,
  client_msg_id text,
  ai_job_id     uuid,
  moderation    public.moderation_verdict not null default 'allow',
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted_at    timestamptz,

  constraint chat_messages_sender check (
    (sender_kind = 'user' and sender_id is not null)
    or (sender_kind in ('ai','system') and sender_id is null)
  )
);

create index chat_messages_channel_idx
  on public.chat_messages(channel_id, created_at desc);

-- Повтор отправки при обрыве связи не создаёт второе сообщение.
create unique index chat_messages_idem_idx
  on public.chat_messages(channel_id, sender_id, client_msg_id)
  where client_msg_id is not null;
