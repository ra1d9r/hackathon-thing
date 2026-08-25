-- 0031 — у экзамена появляется охват программы и время на работу.
--
-- Это то, чем экзамены отличаются друг от друга сильнее всего, а в схеме
-- не было записано вовсе:
--
--   * НИШ сдают в 7 класс по программе 5–6 классов, ЕНТ — по программе
--     7–11. Без этого поля контекст модели пришлось бы ограничивать
--     константами в коде, то есть заводить новый экзамен стало бы правкой
--     кода, а не наполнения;
--   * время работы (ЕНТ — 240 минут, НИШ — 180) нужно пробнику, чтобы
--     дедлайн попытки соответствовал настоящему.

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
