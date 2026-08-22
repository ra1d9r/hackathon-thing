insert into storage.buckets (id, name, public, file_size_limit)
values
  ('avatars',   'avatars',   false, 5242880),
  ('materials', 'materials', false, 209715200)
on conflict (id) do update set
  public          = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists avatars_owner_read on storage.objects;

create policy avatars_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

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
