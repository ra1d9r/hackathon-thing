alter type public.assessment_kind rename value 'ent_mock' to 'exam_mock';

alter table public.questions drop constraint questions_bank_pool_check;
update public.questions set bank_pool = 'exam_mock' where bank_pool = 'ent_mock';
alter table public.questions
  add constraint questions_bank_pool_check
  check (bank_pool is null or bank_pool in ('diagnostic','exam_mock','practice'));

alter table public.exam_profiles
  add column profile_slot_count smallint not null default 0
  check (profile_slot_count between 0 and 5);

create table public.exam_subject_options (
  exam_profile_id uuid not null references public.exam_profiles(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  slot_kind       text not null check (slot_kind in ('mandatory','profile')),
  sort_order      smallint not null default 100,
  primary key (exam_profile_id, subject_id)
);

create index exam_subject_options_profile_idx
  on public.exam_subject_options(exam_profile_id, sort_order);

alter table public.exam_subject_options enable row level security;
alter table public.exam_subject_options force row level security;

create policy exam_subject_options_read on public.exam_subject_options
  for select to authenticated using (true);

grant select on public.exam_subject_options to authenticated;
grant all privileges on public.exam_subject_options to service_role;

update storage.buckets set file_size_limit = 104857600 where id = 'materials';
