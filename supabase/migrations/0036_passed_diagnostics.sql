alter table public.student_profiles
  add column if not exists passed_diagnostics boolean not null default false;

update public.student_profiles sp
   set passed_diagnostics = true
 where sp.passed_diagnostics = false
   and (
     sp.diagnostic_attempt_id is not null
     or exists (
       select 1
         from public.attempts a
         join public.assessments asm on asm.id = a.assessment_id
        where a.student_id = sp.student_id
          and asm.kind = 'diagnostic'
          and a.status = 'graded'
     )
   );

comment on column public.student_profiles.passed_diagnostics is
  'True after the student diagnostic attempt has been completed and graded.';
