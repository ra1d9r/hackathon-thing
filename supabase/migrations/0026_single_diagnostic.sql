create unique index assessments_one_diagnostic_idx
  on public.assessments(student_id)
  where kind = 'diagnostic' and is_active and student_id is not null;
