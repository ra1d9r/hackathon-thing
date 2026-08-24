create or replace function app.claim_ai_jobs(p_worker text, p_limit int)
returns setof public.ai_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with claimed as (
    select j.id
      from public.ai_jobs j
     where j.status in ('queued','awaiting_retry')
       and j.run_after <= now()
       and (
         j.depends_on_job_id is null
         or exists (
           select 1 from public.ai_jobs d
            where d.id = j.depends_on_job_id
              and d.status in ('succeeded','failed','canceled','dead_letter')
         )
       )
     order by j.priority asc, j.created_at asc
     limit p_limit
     for update skip locked
  )
  update public.ai_jobs j
     set status     = 'running',
         locked_by  = p_worker,
         locked_at  = now(),
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
    from claimed c
   where j.id = c.id
  returning j.*;
end $$;

comment on function app.claim_ai_jobs(text, int) is
  'Атомарно захватывает готовые к выполнению задачи очереди. Зависимая задача ждёт завершения предшественника, а не его успеха.';
