-- 0029 — ежедневное обновление приоритетов становится выполнимым.
--
-- `app.refresh_priorities()` написана в 0007 и с тех пор ни разу
-- не вызывалась: в 01-database.md, §6 сказано «вызывается воркером раз
-- в сутки», а обслуживание её не вызывало. Из-за этого слагаемое давности
-- в приоритете не работало вовсе: приоритет темы менялся только при новом
-- свидетельстве, то есть давно заброшенная слабая тема так и оставалась
-- позади тех, по которым ученик недавно занимался, — ровно наоборот тому,
-- ради чего слагаемое вводилось.
--
-- Прямой вызов раз в минуту (обслуживание ходит именно с такой частотой)
-- переписывал бы всю таблицу проекции. Поэтому функция получает окно
-- давности и трогает только те строки, у которых приоритет не пересчитывался
-- дольше него. Раз в сутки для строки — и никакой отдельной таблицы
-- «когда последний раз запускались» с её блокировками и гонками.
--
-- Признак свежести — `updated_at`: его ставит и триггер применения события,
-- и сама функция. Строка, у которой мастерство изменилось час назад, уже
-- получила пересчитанный приоритет, и трогать её раньше времени незачем.

drop function if exists app.refresh_priorities();

create or replace function app.refresh_priorities(p_stale interval default interval '20 hours')
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  affected integer;
begin
  update public.student_topic_mastery m
     set priority = round(
           ((100 - m.mastery_pct) / 100.0)
           * coalesce(t.exam_weight, 1.00)
           * (1.5 - 0.5 * m.confidence)
           * (1 + least(0.5, extract(epoch from (now() - coalesce(m.last_evidence_at, now())))
                              / 86400.0 / 30.0)),
           4),
         updated_at = now()
    from public.topics t
   where t.id = m.topic_id
     and m.status <> 'mastered'
     and m.updated_at < now() - p_stale;

  get diagnostics affected = row_count;
  return affected;
end $$;

comment on function app.refresh_priorities(interval) is
  'Поднимает давно не повторявшиеся слабые темы. Мастерство не меняет: '
  'забывание мы не измеряли, а выдумывать его снижение — значит показывать '
  'пользователю числа, за которыми ничего не стоит. Обновляет только строки, '
  'нетронутые дольше p_stale, поэтому вызывать её можно хоть каждую минуту.';

-- Обслуживание ищет именно устаревшие строки: без индекса это был бы
-- полный просмотр проекции при каждом проходе.
create index if not exists stm_stale_priority_idx
  on public.student_topic_mastery(updated_at)
  where status <> 'mastered';

-- ─── Права ───────────────────────────────────────────────────────────────────
--
-- Явный отзыв обязателен. В 0021 стоит `alter default privileges in schema app
-- revoke execute on functions from public, anon, authenticated`, но записи
-- в pg_default_acl для схемы app эта строка не оставила: у новой функции
-- ACL остаётся пустым, а пустой ACL у функции означает EXECUTE для PUBLIC —
-- то есть и для anon, и для authenticated.
--
-- Проверено сразу после первого применения: `refresh_priorities` оказалась
-- вызываемой из клиентского контура. Инвариант «клиенту доступны ровно шесть
-- вспомогательных функций RLS» держит тест test/db/schema.test.ts — но
-- полагаться на умолчание нельзя, каждая новая функция схемы app обязана
-- закрываться явно.
revoke all on function app.refresh_priorities(interval) from public, anon, authenticated;
grant execute on function app.refresh_priorities(interval) to service_role;
