-- 0028 — то, чего не хватало дашборду.
--
-- Два независимых изменения, оба заранее описаны в проекте:
--   * счётчики фокуса дня (04-domain-logic.md, §2.1) — обещаны «в фазе 6»;
--   * исправление счётчиков активности (09-open-issues.md, B-10).

-- ─── Затухание повторов в фокусе дня ─────────────────────────────────────────
--
-- Брать три темы с наибольшим приоритетом нельзя: пока тема не освоена,
-- её приоритет остаётся высоким, и ученик видел бы один и тот же список
-- неделями. Счётчик подряд идущих попаданий вдвое снижает вес темы при
-- каждом повторе; пропуск хотя бы одного дня возвращает вес к исходному.

alter table public.student_topic_mastery
  add column focus_fatigue smallint not null default 0
    check (focus_fatigue >= 0 and focus_fatigue <= 30),
  add column last_focus_date date;

comment on column public.student_topic_mastery.focus_fatigue is
  'Сколько дней подряд тема попадала в фокус. Каждое попадание снижает её вес вдвое.';
comment on column public.student_topic_mastery.last_focus_date is
  'Дата последнего попадания в фокус. Разрыв в один день обнуляет затухание.';

-- ─── Счётчики активности: только то, что ученик действительно сдал ───────────
--
-- Прежняя версия считала ответы и время по всем попыткам подряд, включая
-- брошенные и незавершённые. На экране это видимая цифра «сколько вопросов
-- отвечено», и она завышалась каждым открытым и закрытым тестом.
--
-- Брошенная попытка — это отказ от результата, и её ответы не должны
-- попадать в статистику наравне со сданными.

create or replace view public.v_student_activity
with (security_invoker = true) as
select
  p.id as student_id,
  coalesce(a.attempts_graded, 0)   as attempts_graded,
  coalesce(a.questions_answered, 0) as questions_answered,
  coalesce(a.attempt_seconds, 0) + coalesce(s.session_seconds, 0) as study_seconds
from public.profiles p
left join lateral (
  select
    count(*) filter (where at.status = 'graded')          as attempts_graded,
    coalesce(sum(at.time_spent_sec), 0)                   as attempt_seconds,
    coalesce(sum(ans.answer_count), 0)                    as questions_answered
  from public.attempts at
  left join lateral (
    select count(*) as answer_count
      from public.attempt_answers aa
     where aa.attempt_id = at.id
  ) ans on true
  where at.student_id = p.id
    -- Отправленные и всё, что после: брошенные и незавершённые не в счёт.
    and at.status in ('submitted','grading','graded','failed')
) a on true
left join lateral (
  select coalesce(sum(ss.seconds), 0) as session_seconds
    from public.study_sessions ss
   where ss.student_id = p.id
) s on true
where p.role = 'student';

comment on view public.v_student_activity is
  'Счётчики для блока аналитики: сданные попытки, отвеченные вопросы и время за обучением.';
