
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all routines in schema public to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;

grant usage on schema public to authenticated;

grant select on
  -- личность и каталог
  public.profiles,
  public.student_profiles,
  public.student_subjects,
  public.subjects,
  public.topics,
  public.topic_prerequisites,
  public.exam_profiles,
  public.exam_sections,
  -- материалы и уроки
  public.materials,
  public.material_topics,
  public.lessons,
  public.file_objects,
  -- собственный учебный прогресс
  public.assessments,
  public.attempts,
  public.attempt_answers,
  public.student_topic_mastery,
  public.student_subject_mastery,
  public.mastery_snapshots,
  public.predicted_scores,
  public.study_sessions,
  public.lesson_progress,
  public.roadmaps,
  public.roadmap_nodes,
  public.daily_plans,
  public.daily_plan_items,
  public.student_streaks,
  -- класс, рассылки, чат
  public.classes,
  public.class_members,
  public.material_distributions,
  public.distribution_receipts,
  public.chat_channels,
  public.chat_channel_members,
  public.chat_messages
to authenticated;

grant select on
  public.v_student_weak_topics,
  public.v_student_activity
to authenticated;


revoke all on all tables in schema public from anon;

revoke all on
  public.questions,
  public.assessment_questions,
  public.stat_events,
  public.onboarding_answers,
  public.ai_jobs,
  public.ai_call_logs,
  public.idempotency_keys,
  public.rate_limit_counters,
  public.audit_log
from anon, authenticated;
