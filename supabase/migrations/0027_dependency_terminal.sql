-- 0027 — зависимая работа ждёт завершения предшественника, а не его успеха.
--
-- В 0010 условие захвата требовало `d.status = 'succeeded'`. Пока обработчики
-- поглощали любой отказ и всегда завершались успешно, разница не проявлялась.
-- С появлением повторов при недоступности провайдера (фаза 5) работа может
-- закончиться в `failed` или `dead_letter` — и тогда зависимая от неё
-- оставалась в `queued` навсегда: захватить её нельзя, а попытка ученика
-- так и висела бы в состоянии «оценивается».
--
-- Смысл зависимости — порядок, а не успех. Разбор попытки обязан увидеть уже
-- выставленные баллы; если выставить их не удалось, он честно разберёт то,
-- что есть, и пометит остальное как ожидающее проверки. Именно для этого
-- и написан детерминированный заменитель.

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
       -- Предшественник должен дойти до конечного состояния — любого.
       -- Незавершённый блокирует, завершившийся неудачей — нет.
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
     -- SKIP LOCKED: несколько воркеров разбирают очередь, не мешая друг другу.
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
