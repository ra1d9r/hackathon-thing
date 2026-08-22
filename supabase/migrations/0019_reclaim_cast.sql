

create or replace function app.reclaim_stale_jobs(p_timeout interval default interval '5 minutes')
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  affected integer;
begin
  update public.ai_jobs
     set status     = (case
                        when attempts + 1 >= max_attempts then 'dead_letter'
                        else 'awaiting_retry'
                      end)::public.ai_job_status,
         attempts   = attempts + 1,
         locked_by  = null,
         locked_at  = null,
         run_after  = now() + (interval '10 seconds' * power(2, least(attempts, 5))),
         updated_at = now()
   where status = 'running'
     and locked_at < now() - p_timeout;

  get diagnostics affected = row_count;
  return affected;
end $$;

comment on function app.reclaim_stale_jobs(interval) is
  'Возвращает в очередь задачи, зависшие после падения воркера; исчерпавшие попытки уходит в dead_letter.';
