

create or replace function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.bump_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

create or replace function app.enforce_immutable_identity() returns trigger
language plpgsql
set search_path = ''
as $$
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

create or replace function app.notify_job_terminal() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('succeeded','failed','canceled','dead_letter')
     and new.status is distinct from old.status then
    perform pg_notify('ai_job_done', new.id::text);
  end if;
  return new;
end $$;
