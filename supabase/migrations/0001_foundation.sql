create extension if not exists pgcrypto;

create schema if not exists app;

grant usage on schema app to anon, authenticated, service_role;


create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

comment on function app.touch_updated_at() is
  'Проставляет updated_at при обновлении строки.';

create or replace function app.bump_version() returns trigger
language plpgsql as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

comment on function app.bump_version() is
  'Увеличивает version при обновлении строки (оптимистическая блокировка).';
