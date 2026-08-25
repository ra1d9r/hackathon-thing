-- 0001 — основание схемы: расширения, служебная схема, общие триггерные функции.
--
-- Схема `app` — служебная: её объекты не публикуются через PostgREST и не
-- предназначены для вызова клиентом. Права на конкретные функции выдаются
-- точечно в миграции 0012 (RLS).

create extension if not exists pgcrypto;

create schema if not exists app;

-- USAGE нужен, чтобы политики RLS могли вызывать вспомогательные функции
-- из-под роли authenticated. Право EXECUTE на конкретные функции выдаётся
-- отдельно; всё остальное в схеме остаётся закрытым (см. 0012).
grant usage on schema app to anon, authenticated, service_role;

-- ─── Общие триггерные функции ────────────────────────────────────────────────

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

comment on function app.touch_updated_at() is
  'Проставляет updated_at при обновлении строки.';

-- Оптимистическая блокировка: любое обновление увеличивает version.
-- Используется там, где параллельная запись возможна (профили, мастерство).
create or replace function app.bump_version() returns trigger
language plpgsql as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

comment on function app.bump_version() is
  'Увеличивает version при обновлении строки (оптимистическая блокировка).';
