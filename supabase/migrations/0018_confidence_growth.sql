
alter table public.student_topic_mastery
  add column evidence_weight_sum numeric(7,2) not null default 0
  check (evidence_weight_sum >= 0);

comment on column public.student_topic_mastery.evidence_weight_sum is
  'Сумма весов свидетельств. Полная уверенность достигается при значении 5.';

create or replace function app.confidence_from_evidence(p_weight_sum numeric)
returns numeric
language sql immutable
set search_path = ''
as $$
  select least(1.00, greatest(0.00, round(coalesce(p_weight_sum, 0) / 5.0, 2)))
$$;

create or replace function app.apply_stat_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prev_row   public.student_topic_mastery%rowtype;
  prev_pct   numeric(5,2);
  new_pct    numeric(5,2);
  new_sum    numeric(7,2);
  new_conf   numeric(3,2);
  new_count  integer;
  topic_w    numeric(4,2);
  new_status public.mastery_status;
  new_prio   numeric(6,4);
begin
  select * into prev_row
    from public.student_topic_mastery
   where student_id = new.student_id and topic_id = new.topic_id
     for update;

  prev_pct  := coalesce(prev_row.mastery_pct, new.baseline_pct, 0);
  new_count := coalesce(prev_row.evidence_count, 0) + 1;
  new_pct   := least(100, greatest(0, prev_pct + new.delta_pct));
  new_sum   := coalesce(prev_row.evidence_weight_sum, 0) + new.evidence_weight;
  new_conf  := app.confidence_from_evidence(new_sum);

  new_status := case
    when new_pct >= 100 then 'mastered'
    when new_pct <  40  then 'weak'
    when new_pct <  70  then 'improving'
    else 'strong'
  end;

  select coalesce(t.exam_weight, 1.00) into topic_w
    from public.topics t where t.id = new.topic_id;

  new_prio := case
    when new_status = 'mastered' then 0
    else round(((100 - new_pct) / 100.0) * topic_w * (1.5 - 0.5 * new_conf), 4)
  end;

  insert into public.student_topic_mastery as m (
    student_id, topic_id, subject_id, mastery_pct, confidence, evidence_count,
    evidence_weight_sum, priority, status, first_evidence_at, last_evidence_at,
    updated_at, version
  ) values (
    new.student_id, new.topic_id, new.subject_id, new_pct, new_conf, new_count,
    new_sum, new_prio, new_status, new.created_at, new.created_at, now(), 1
  )
  on conflict (student_id, topic_id) do update set
    mastery_pct         = excluded.mastery_pct,
    confidence          = excluded.confidence,
    evidence_count      = excluded.evidence_count,
    evidence_weight_sum = excluded.evidence_weight_sum,
    priority            = excluded.priority,
    status              = excluded.status,
    last_evidence_at    = excluded.last_evidence_at,
    updated_at          = now(),
    version             = m.version + 1;

  perform app.recompute_subject_mastery(new.student_id, new.subject_id);
  return new;
end $$;

update public.student_topic_mastery m
   set evidence_weight_sum = agg.weight_sum,
       confidence          = app.confidence_from_evidence(agg.weight_sum)
  from (
    select student_id, topic_id, sum(evidence_weight) as weight_sum
      from public.stat_events
     group by student_id, topic_id
  ) agg
 where agg.student_id = m.student_id
   and agg.topic_id = m.topic_id;

select app.refresh_priorities();
