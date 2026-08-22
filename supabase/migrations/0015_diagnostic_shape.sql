
alter table public.assessments
  drop constraint assessments_personal;

alter table public.assessments
  add constraint assessments_personal check (
   
    (kind = 'ent_mock' and student_id is null)
    or (kind in ('diagnostic','ai_task','knowledge_check') and student_id is not null)
  );


alter table public.questions
  add column bank_pool text
  check (bank_pool is null or bank_pool in ('diagnostic','ent_mock','practice'));

comment on column public.questions.bank_pool is
  'Назначение вопроса банка. Отбор в диагностику идёт только по pool = diagnostic.';

alter table public.questions
  add constraint questions_bank_pool_required check (
    (origin = 'bank' and bank_pool is not null)
    or (origin = 'generated' and bank_pool is null)
  );

create index questions_pool_idx
  on public.questions(bank_pool, subject_id, grade)
  where is_active and origin = 'bank';
