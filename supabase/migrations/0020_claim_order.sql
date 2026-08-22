
create or replace function app.claim_ai_jobs(p_worker text, p_limit int)
returns setof public.ai_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with candidates as (
    select j.id
      from public.ai_jobs j
     where j.status in ('queued','awaiting_retry')
       and j.run_after <= now()
       and (
         j.depends_on_job_id is null
         or exists (
           select 1 from public.ai_jobs d
            where d.id = j.depends_on_job_id and d.status = 'succeeded'
         )
       )
     order by j.priority asc, j.created_at asc
     limit p_limit
     for update skip locked
  ),
  claimed as (
    update public.ai_jobs j
       set status     = 'running',
           locked_by  = p_worker,
           locked_at  = now(),
           started_at = coalesce(j.started_at, now()),
           updated_at = now()
      from candidates c
     where j.id = c.id
    returning j.*
  )
  select * from claimed
   order by claimed.priority asc, claimed.created_at asc;
end $$;

comment on function app.claim_ai_jobs(text, int) is
  'Атомарно захватывает готовые задачи и возвращает их в порядке приоритета.';
