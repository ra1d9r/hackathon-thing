-- 0005 — файлы и учебные материалы.
--
-- Файл в Storage и запись о нём разделены: запись создаётся до загрузки
-- (scan_status = 'pending') и переводится в 'clean' только после того, как
-- backend сверил сигнатуру содержимого с заявленным типом. Материал не
-- публикуется, пока файл не проверен.

create table public.file_objects (
  id              uuid primary key default gen_random_uuid(),
  bucket          text not null check (bucket in ('avatars','materials')),
  path            text not null,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  original_name   text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  checksum_sha256 text,
  scan_status     public.scan_status not null default 'pending',
  created_at      timestamptz not null default now(),

  constraint file_objects_path_unique unique (bucket, path)
);

comment on column public.file_objects.path is
  'Путь в бакете строится из идентификаторов, без имени файла пользователя: обход каталогов невозможен.';

create index file_objects_owner_idx on public.file_objects(owner_id);

-- Отложенный внешний ключ из 0003.
alter table public.profiles
  add constraint profiles_avatar_fk
  foreign key (avatar_file_id) references public.file_objects(id) on delete set null;

-- ─── Материалы ───────────────────────────────────────────────────────────────

create table public.materials (
  id               uuid primary key default gen_random_uuid(),
  kind             public.material_kind not null,
  format           public.material_format not null,
  subject_id       uuid references public.subjects(id) on delete set null,
  grade_min        smallint check (grade_min between 7 and 12),
  grade_max        smallint check (grade_max between 7 and 12),
  title            text not null check (char_length(title) between 1 and 200),
  summary          text check (char_length(summary) <= 500),
  body_md          text,
  file_id          uuid references public.file_objects(id) on delete set null,
  external_url     text,
  author_id        uuid references public.profiles(id) on delete set null,
  class_id         uuid,                    -- FK добавляется в 0009
  status           public.material_status not null default 'published',
  content_hash     text not null,
  est_read_minutes smallint check (est_read_minutes between 1 and 240),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,

  -- Ровно один носитель содержимого: текст, файл или ссылка.
  -- Без этого материал мог бы одновременно ссылаться на файл и содержать текст,
  -- и было бы неясно, что показывать и что кэшировать офлайн.
  constraint materials_single_payload check (
    (format in ('markdown','txt')
       and body_md is not null and file_id is null and external_url is null)
    or (format in ('pdf','docx','pptx','video')
       and file_id is not null and external_url is null and body_md is null)
    or (format = 'link'
       and external_url is not null and file_id is null and body_md is null)
  ),

  -- Схемы javascript:, data: и подобные отсекаются санитайзером на входе;
  -- здесь — последний рубеж на случай записи в обход API.
  constraint materials_url_scheme
    check (external_url is null or external_url ~* '^https?://'),

  constraint materials_grade_range
    check (grade_min is null or grade_max is null or grade_min <= grade_max)
);

comment on column public.materials.content_hash is
  'sha256 содержимого. Клиент использует его как ключ инвалидации офлайн-кэша.';

create index materials_subject_idx on public.materials(subject_id) where status = 'published';
create index materials_class_idx on public.materials(class_id);
create index materials_author_idx on public.materials(author_id);

create trigger materials_touch
  before update on public.materials
  for each row execute function app.touch_updated_at();

create trigger materials_version
  before update on public.materials
  for each row execute function app.bump_version();

-- Связь материала с темами: по ней AI подбирает материал в roadmap,
-- а backend проверяет, что предложенный материал относится к нужной теме.
create table public.material_topics (
  material_id uuid not null references public.materials(id) on delete cascade,
  topic_id    uuid not null references public.topics(id) on delete cascade,
  weight      numeric(3,2) not null default 1.00 check (weight > 0 and weight <= 1),
  primary key (material_id, topic_id)
);

create index material_topics_topic_idx on public.material_topics(topic_id);
