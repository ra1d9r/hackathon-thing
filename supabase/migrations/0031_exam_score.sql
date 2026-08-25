alter table public.exam_profiles
  add column if not exists grade_min      smallint check (grade_min between 5 and 11),
  add column if not exists grade_max      smallint check (grade_max between 5 and 11),
  add column if not exists time_limit_sec integer  check (time_limit_sec between 60 and 43200);

alter table public.exam_profiles
  add constraint exam_profiles_grade_range
  check (grade_min is null or grade_max is null or grade_min <= grade_max);

comment on column public.exam_profiles.grade_min is
  'Нижний класс программы экзамена. Ограничивает и подбор вопросов, и контекст модели.';
comment on column public.exam_profiles.time_limit_sec is
  'Сколько длится настоящий экзамен. Пробник ставит такой же дедлайн.';
