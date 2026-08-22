
alter table public.chat_messages
  drop constraint chat_messages_sender;

alter table public.chat_messages
  add constraint chat_messages_sender check (
    sender_kind = 'user' or sender_id is null
  );

comment on column public.chat_messages.sender_id is
  'Пустое значение при sender_kind = user означает удалённый аккаунт: переписка сохраняется.';


alter table public.daily_plan_items
  drop constraint daily_plan_items_assessment_id_fkey;

alter table public.daily_plan_items
  add constraint daily_plan_items_assessment_id_fkey
  foreign key (assessment_id) references public.assessments(id) on delete cascade;

alter table public.daily_plan_items
  drop constraint daily_plan_items_lesson_id_fkey;

alter table public.daily_plan_items
  add constraint daily_plan_items_lesson_id_fkey
  foreign key (lesson_id) references public.lessons(id) on delete cascade;
