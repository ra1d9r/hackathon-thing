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

create index if not exists stm_stale_priority_idx
  on public.student_topic_mastery(updated_at)
  where status <> 'mastered';

revoke all on function app.refresh_priorities(interval) from public, anon, authenticated;
grant execute on function app.refresh_priorities(interval) to service_role;
