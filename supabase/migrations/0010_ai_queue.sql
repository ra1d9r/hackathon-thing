-- 0010 — очередь операций ИИ, идемпотентность, лимиты, аудит.
--
-- Очередь живёт в Postgres, а не во внешнем брокере: для MVP это на одну
-- движущуюся часть меньше, а FOR UPDATE SKIP LOCKED и LISTEN/NOTIFY дают
-- всё нужное — захват задач несколькими воркерами и мгновенное пробуждение
-- ожидающих HTTP-запросов (см. docs/03-ai-integration.md, §8).

create table public.ai_jobs (
  id                 uuid primary key default gen_random_uuid(),
  op_type            public.ai_op_type not null,
  status             public.ai_job_status not null default 'queued',
  requested_by       uuid not null references public.profiles(id) on delete cascade,
  student_id         uuid references public.profiles(id) on delete cascade,
  priority           smallint not null default 100,
  dedupe_key         text not null,
  idempotency_key    text,
  depends_on_job_id  uuid references public.ai_jobs(id) on delete set null,
  input              jsonb not null,
  input_hash         text not null,
  result             jsonb,
  error              jsonb,
  attempts           smallint not null default 0 check (attempts >= 0),
  max_attempts       smallint not null default 5 check (max_attempts >= 1),
  run_after          timestamptz not null default now(),
  locked_by          text,
  locked_at          timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  applied_at         timestamptz,
  model              text,
  tokens_input       integer,
  tokens_output      integer,
  tokens_cache_read  integer,
  tokens_cache_write integer,
  latency_ms         integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint ai_jobs_terminal_consistency
    check (status <> 'succeeded' or result is not null)
);

comment on column public.ai_jobs.priority is
  'Меньше — важнее. Интерактивные операции обгоняют фоновые.';
comment on column public.ai_jobs.applied_at is
  'Момент применения побочных эффектов. Второй раз результат не применяется.';

-- Одна активная работа на логическую операцию. Именно это делает
-- отложенные запросы безопасными: сколько бы раз клиент ни повторил
-- отправку или опрос, операция остаётся одна.
create unique index ai_jobs_active_dedupe_idx
  on public.ai_jobs(dedupe_key)
  where status in ('queued','running','awaiting_retry');

create index ai_jobs_claim_idx
  on public.ai_jobs(status, run_after, priority, created_at)
  where status in ('queued','awaiting_retry');

create index ai_jobs_student_idx on public.ai_jobs(student_id, created_at desc);
create index ai_jobs_stale_lock_idx on public.ai_jobs(locked_at) where status = 'running';

create trigger ai_jobs_touch
  before update on public.ai_jobs
  for each row execute function app.touch_updated_at();

-- ─── Журнал вызовов модели ───────────────────────────────────────────────────

create table public.ai_call_logs (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid references public.ai_jobs(id) on delete cascade,
  attempt_no         smallint not null,
  op_type            public.ai_op_type not null,
  model              text not null,
  ok                 boolean not null,
  http_status        integer,
  error_code         text,
  stop_reason        text,
  prompt_hash        text not null,
  tokens_input       integer,
  tokens_output      integer,
  tokens_cache_read  integer,
  tokens_cache_write integer,
  latency_ms         integer,
  request_id         text,
  created_at         timestamptz not null default now()
);

comment on column public.ai_call_logs.prompt_hash is
  'Хэш промпта вместо самого промпта: содержимое ответов учеников в логи не попадает.';
comment on column public.ai_call_logs.tokens_cache_read is
  'Доля попаданий в префиксный кэш считается по этому полю.';

create index ai_call_logs_job_idx on public.ai_call_logs(job_id, attempt_no);
create index ai_call_logs_time_idx on public.ai_call_logs(created_at desc);

-- ─── Идемпотентность ─────────────────────────────────────────────────────────

create table public.idempotency_keys (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  route           text not null,
  key             text not null,
  request_hash    text not null,
  status          text not null default 'in_progress'
                  check (status in ('in_progress','completed')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours'),

  constraint idempotency_unique unique (user_id, route, key)
);

comment on column public.idempotency_keys.request_hash is
  'Отпечаток тела запроса: тот же ключ с другими данными — ошибка, а не повтор.';

create index idempotency_expiry_idx on public.idempotency_keys(expires_at);

create table public.rate_limit_counters (
  bucket_key   text primary key,
  window_start timestamptz not null,
  counter      integer not null default 0,
  updated_at   timestamptz not null default now()
);

create table public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_role  public.user_role,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  summary     jsonb not null default '{}'::jsonb,
  request_id  text,
  created_at  timestamptz not null default now()
);

create index audit_log_entity_idx on public.audit_log(entity_type, entity_id, created_at desc);
create index audit_log_actor_idx on public.audit_log(actor_id, created_at desc);

-- ─── Захват задач воркером ───────────────────────────────────────────────────

create or replace function app.claim_ai_jobs(p_worker text, p_limit int)
returns setof public.ai_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with claimed as (
    select j.id
      from public.ai_jobs j
     where j.status in ('queued','awaiting_retry')
       and j.run_after <= now()
       -- Зависимая работа ждёт успеха предшественника: анализ попытки не
       -- имеет смысла, пока не завершено оценивание свободных ответов.
       and (
         j.depends_on_job_id is null
         or exists (
           select 1 from public.ai_jobs d
            where d.id = j.depends_on_job_id and d.status = 'succeeded'
         )
       )
     order by j.priority asc, j.created_at asc
     limit p_limit
     -- SKIP LOCKED: несколько воркеров разбирают очередь, не мешая друг другу.
     for update skip locked
  )
  update public.ai_jobs j
     set status     = 'running',
         locked_by  = p_worker,
         locked_at  = now(),
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
    from claimed c
   where j.id = c.id
  returning j.*;
end $$;

comment on function app.claim_ai_jobs(text, int) is
  'Атомарно захватывает готовые к выполнению задачи очереди.';

-- Возврат зависших задач: воркер мог упасть посреди выполнения.
-- Повторное применение безопасно благодаря applied_at и уникальным индексам.
create or replace function app.reclaim_stale_jobs(p_timeout interval default interval '5 minutes')
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  affected integer;
begin
  update public.ai_jobs
     set status     = case
                        when attempts + 1 >= max_attempts then 'dead_letter'
                        else 'awaiting_retry'
                      end,
         attempts   = attempts + 1,
         locked_by  = null,
         locked_at  = null,
         run_after  = now() + (interval '10 seconds' * power(2, least(attempts, 5))),
         updated_at = now()
   where status = 'running'
     and locked_at < now() - p_timeout;

  get diagnostics affected = row_count;
  return affected;
end $$;

-- ─── Пробуждение ожидающих запросов ──────────────────────────────────────────

-- Долгий опрос статуса (sleeper request) висит на LISTEN и просыпается
-- мгновенно, как только работа дошла до конечного состояния.
create or replace function app.notify_job_terminal() returns trigger
language plpgsql as $$
begin
  if new.status in ('succeeded','failed','canceled','dead_letter')
     and new.status is distinct from old.status then
    perform pg_notify('ai_job_done', new.id::text);
  end if;
  return new;
end $$;

create trigger ai_jobs_notify
  after update on public.ai_jobs
  for each row execute function app.notify_job_terminal();
