alter table public.chat_messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles(id) on delete set null;

alter table public.chat_messages
  drop constraint if exists chat_messages_pinned_pair;

alter table public.chat_messages
  add constraint chat_messages_pinned_pair check (
    (pinned_at is null and pinned_by is null)
    or (pinned_at is not null and pinned_by is not null)
  );

create index if not exists chat_messages_pinned_idx
  on public.chat_messages(channel_id, created_at desc)
  where pinned_at is not null and deleted_at is null;

comment on column public.chat_messages.pinned_at is
  'Момент закрепления. Закреплять может только учитель класса; показывается самое свежее по времени отправки.';
