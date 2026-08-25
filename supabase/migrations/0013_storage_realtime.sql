-- 0013 — приватные бакеты Storage и публикация чата в Realtime.

-- ─── Storage ─────────────────────────────────────────────────────────────────
--
-- Оба бакета приватные. Загрузка идёт по подписанной ссылке, которую API
-- выдаёт после проверки типа и размера; скачивание — тоже по подписанной
-- ссылке и только тем, кому файл виден. Публичных URL нет.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('avatars',   'avatars',   false, 5242880),      -- 5 МБ
  ('materials', 'materials', false, 209715200)     -- 200 МБ (видео)
on conflict (id) do update set
  public          = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Владелец читает собственный аватар напрямую: путь начинается с его uuid.
-- Для чужих аватаров и для всех материалов ссылку выдаёт API — так проверка
-- видимости остаётся в одном месте, а не дублируется политиками Storage.
drop policy if exists avatars_owner_read on storage.objects;

create policy avatars_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ─── Realtime ────────────────────────────────────────────────────────────────
--
-- Публикуется только таблица сообщений: это единственное место, где клиенту
-- нужны обновления без опроса. Чтение ограничено политикой
-- messages_member_select из 0012; отправка идёт через API.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
