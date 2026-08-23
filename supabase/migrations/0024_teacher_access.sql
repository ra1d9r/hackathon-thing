create type public.teacher_request_status as enum ('pending','approved','rejected','used');

create table public.teacher_access_requests (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  display_name       text not null check (char_length(display_name) between 1 and 64),
  organization_email text not null,
  organization_name  text check (char_length(organization_name) <= 160),
  message            text check (char_length(message) <= 1000),
  status             public.teacher_request_status not null default 'pending',
  decided_at         timestamptz,
  decided_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index teacher_access_requests_open_idx
  on public.teacher_access_requests(lower(email))
  where status in ('pending','approved');

create index teacher_access_requests_status_idx
  on public.teacher_access_requests(status, created_at desc);

alter table public.teacher_access_requests enable row level security;
alter table public.teacher_access_requests force row level security;

grant all privileges on public.teacher_access_requests to service_role;

create trigger teacher_access_requests_touch
  before update on public.teacher_access_requests
  for each row execute function app.touch_updated_at();

comment on table public.teacher_access_requests is
  'Заявки на роль учителя. Политик RLS нет: работа с ними идёт только через API.';
comment on column public.teacher_access_requests.decided_by is
  'Кто одобрил: домен организации при автоматическом одобрении либо оператор.';
