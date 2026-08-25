-- 0012 — RLS: вспомогательные функции, включение защиты, политики.
--
-- Модель доступа (см. docs/01-database.md, §10):
--   * все доменные операции идут через API под сервисным ключом;
--   * клиент обращается к базе напрямую только двумя путями — подписка
--     Realtime на чат и Storage;
--   * поэтому роли authenticated выдаётся ТОЛЬКО SELECT и только там, где
--     это нужно. Ни одной политики INSERT/UPDATE/DELETE в схеме нет.
--
-- Таблицы без политик недоступны клиенту полностью. Это сознательный выбор
-- для questions (эталонные ответы), stat_events и всей служебной части.

-- ─── Вспомогательные функции ─────────────────────────────────────────────────
--
-- SECURITY DEFINER здесь не про привилегии, а про разрыв рекурсии: политика
-- на classes ссылается на class_members, политика на class_members — на
-- classes. Без выхода из-под RLS внутри функции это зациклилось бы.

create or replace function app.my_role() returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function app.is_teacher() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.my_role() = 'teacher', false)
$$;

create or replace function app.is_class_member(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.class_members cm
     where cm.class_id = p_class_id
       and cm.student_id = (select auth.uid())
       and cm.status = 'active'
  )
$$;

create or replace function app.owns_class(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.classes c
     where c.id = p_class_id
       and c.teacher_id = (select auth.uid())
       and not c.is_archived
  )
$$;

-- Пересечение по любому общему классу: нужно, чтобы участники чата видели
-- имена друг друга, но не всю базу пользователей.
create or replace function app.shares_class_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.class_members cm
      join public.classes c on c.id = cm.class_id
     where cm.status = 'active'
       and (
         (cm.student_id = (select auth.uid()) and c.teacher_id = p_user_id)
         or (cm.student_id = p_user_id and c.teacher_id = (select auth.uid()))
         or (
           cm.student_id = (select auth.uid())
           and exists (
             select 1 from public.class_members cm2
              where cm2.class_id = cm.class_id
                and cm2.student_id = p_user_id
                and cm2.status = 'active'
           )
         )
       )
  )
$$;

create or replace function app.is_channel_member(p_channel_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.chat_channel_members m
     where m.channel_id = p_channel_id
       and m.user_id = (select auth.uid())
  )
$$;

-- Права на функции схемы app: по умолчанию EXECUTE выдаётся PUBLIC, что
-- открыло бы клиенту, например, захват задач очереди. Закрываем всё и
-- возвращаем доступ только вспомогательным функциям политик.
revoke all on all functions in schema app from public, anon, authenticated;

grant execute on function
  app.my_role(),
  app.is_teacher(),
  app.is_class_member(uuid),
  app.owns_class(uuid),
  app.shares_class_with(uuid),
  app.is_channel_member(uuid)
to authenticated;

-- Функции, созданные в схеме app позже, тоже не должны быть публичными.
alter default privileges in schema app revoke execute on functions from public;

-- ─── Включение RLS на всех таблицах схемы public ─────────────────────────────
--
-- Сплошным проходом, а не перечислением: забыть таблицу в списке легко,
-- и цена ошибки — открытые данные. Тест rls.test.ts проверяет, что покрытие
-- осталось полным и после будущих миграций.

do $$
declare
  table_name text;
begin
  for table_name in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

-- ─── Профили ─────────────────────────────────────────────────────────────────

create policy profiles_self_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_classmates_select on public.profiles
  for select to authenticated
  using (app.shares_class_with(id));

-- ─── Каталог (доступен на чтение всем аутентифицированным) ───────────────────

create policy subjects_read on public.subjects
  for select to authenticated using (is_active);

create policy topics_read on public.topics
  for select to authenticated using (is_active);

create policy topic_prerequisites_read on public.topic_prerequisites
  for select to authenticated using (true);

create policy exam_profiles_read on public.exam_profiles
  for select to authenticated using (is_active);

create policy exam_sections_read on public.exam_sections
  for select to authenticated using (true);

create policy lessons_read on public.lessons
  for select to authenticated using (is_active);

-- ─── Материалы ───────────────────────────────────────────────────────────────

create policy materials_read on public.materials
  for select to authenticated
  using (
    status = 'published'
    and (
      kind = 'library'
      or author_id = (select auth.uid())
      or (class_id is not null and (app.is_class_member(class_id) or app.owns_class(class_id)))
      or exists (
        select 1 from public.material_distributions d
         where d.material_id = materials.id
           and d.student_id = (select auth.uid())
      )
    )
  );

create policy material_topics_read on public.material_topics
  for select to authenticated
  using (exists (select 1 from public.materials m where m.id = material_id));

-- ─── Личные данные ученика ───────────────────────────────────────────────────

create policy student_profiles_self on public.student_profiles
  for select to authenticated using (student_id = (select auth.uid()));

create policy student_subjects_self on public.student_subjects
  for select to authenticated using (student_id = (select auth.uid()));

create policy stm_self on public.student_topic_mastery
  for select to authenticated using (student_id = (select auth.uid()));

create policy ssm_self on public.student_subject_mastery
  for select to authenticated using (student_id = (select auth.uid()));

create policy predicted_scores_self on public.predicted_scores
  for select to authenticated using (student_id = (select auth.uid()));

create policy mastery_snapshots_self on public.mastery_snapshots
  for select to authenticated using (student_id = (select auth.uid()));

create policy study_sessions_self on public.study_sessions
  for select to authenticated using (student_id = (select auth.uid()));

create policy attempts_self on public.attempts
  for select to authenticated using (student_id = (select auth.uid()));

create policy attempt_answers_self on public.attempt_answers
  for select to authenticated
  using (
    exists (
      select 1 from public.attempts a
       where a.id = attempt_id and a.student_id = (select auth.uid())
    )
  );

create policy lesson_progress_self on public.lesson_progress
  for select to authenticated using (student_id = (select auth.uid()));

create policy roadmaps_self on public.roadmaps
  for select to authenticated using (student_id = (select auth.uid()));

create policy roadmap_nodes_self on public.roadmap_nodes
  for select to authenticated
  using (
    exists (
      select 1 from public.roadmaps r
       where r.id = roadmap_id and r.student_id = (select auth.uid())
    )
  );

create policy daily_plans_self on public.daily_plans
  for select to authenticated using (student_id = (select auth.uid()));

create policy daily_items_self on public.daily_plan_items
  for select to authenticated
  using (
    exists (
      select 1 from public.daily_plans p
       where p.id = plan_id and p.student_id = (select auth.uid())
    )
  );

create policy streaks_self on public.student_streaks
  for select to authenticated using (student_id = (select auth.uid()));

-- Персональные тесты видит только их владелец; общие (диагностика, пробники)
-- видны всем — состав вопросов всё равно приходит через API без эталонов.
create policy assessments_visible on public.assessments
  for select to authenticated
  using (is_active and (student_id is null or student_id = (select auth.uid())));

-- ─── Классы и рассылки ───────────────────────────────────────────────────────

create policy classes_visible on public.classes
  for select to authenticated
  using (teacher_id = (select auth.uid()) or app.is_class_member(id));

create policy class_members_visible on public.class_members
  for select to authenticated
  using (student_id = (select auth.uid()) or app.owns_class(class_id));

create policy distributions_visible on public.material_distributions
  for select to authenticated
  using (
    teacher_id = (select auth.uid())
    or student_id = (select auth.uid())
    or (class_id is not null and app.is_class_member(class_id))
  );

create policy receipts_visible on public.distribution_receipts
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.material_distributions d
       where d.id = distribution_id and d.teacher_id = (select auth.uid())
    )
  );

-- ─── Чат: единственный путь прямого чтения из клиента ────────────────────────

create policy channels_member_select on public.chat_channels
  for select to authenticated
  using (owner_id = (select auth.uid()) or app.is_channel_member(id));

create policy channel_members_select on public.chat_channel_members
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_channel_member(channel_id));

create policy messages_member_select on public.chat_messages
  for select to authenticated
  using (deleted_at is null and app.is_channel_member(channel_id));

-- ─── Файлы ───────────────────────────────────────────────────────────────────

-- Метаданные своего файла (нужны для показа имени и размера).
-- Само содержимое отдаётся только по подписанной ссылке от API.
create policy file_objects_owner on public.file_objects
  for select to authenticated using (owner_id = (select auth.uid()));
