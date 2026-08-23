alter table public.exam_profiles add column goal public.learning_goal;

update public.exam_profiles set goal = 'ent'      where code = 'ent';
update public.exam_profiles set goal = 'nis'      where code = 'nis';
update public.exam_profiles set goal = 'olympiad' where goal is null;

alter table public.exam_profiles alter column goal set not null;

alter table public.exam_profiles
  add constraint exam_profiles_goal_not_subjects check (goal <> 'subjects');

create index exam_profiles_goal_idx on public.exam_profiles(goal) where is_active;

create table public.learning_goals (
  goal        public.learning_goal primary key,
  title_ru    text not null,
  description_ru text not null,
  sort_order  smallint not null default 100,
  is_active   boolean not null default true
);

alter table public.learning_goals enable row level security;
alter table public.learning_goals force row level security;

create policy learning_goals_read on public.learning_goals
  for select to authenticated using (is_active);

grant select on public.learning_goals to authenticated;
grant all privileges on public.learning_goals to service_role;
