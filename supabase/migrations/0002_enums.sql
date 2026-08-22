create type public.user_role            as enum ('student','teacher');
create type public.learning_goal        as enum ('ent','nis','olympiad','subjects');
create type public.question_kind        as enum ('mcq_single','mcq_multi','free_text','numeric');
create type public.question_origin      as enum ('bank','generated');
create type public.assessment_kind      as enum ('diagnostic','ent_mock','ai_task','knowledge_check');
create type public.attempt_status       as enum ('in_progress','submitted','grading','graded','failed','abandoned');
create type public.grader_kind          as enum ('deterministic','ai','pending');
create type public.mastery_status       as enum ('unknown','weak','improving','strong','mastered');
create type public.roadmap_node_status  as enum ('locked','available','in_progress','completed');
create type public.daily_item_status    as enum ('pending','in_progress','completed','skipped');
create type public.material_kind        as enum ('library','teacher_upload','teacher_link','teacher_text');
create type public.material_format      as enum ('markdown','pdf','docx','pptx','txt','video','link');
create type public.material_status      as enum ('draft','published','blocked');
create type public.channel_kind         as enum ('class_chat','ai_assistant');
create type public.sender_kind          as enum ('user','ai','system');
create type public.moderation_verdict   as enum ('allow','block','redirect');
create type public.scan_status          as enum ('pending','clean','rejected');
create type public.membership_status    as enum ('active','removed');

create type public.ai_op_type as enum (
  'diagnostic_analysis',
  'free_text_grading',
  'attempt_analysis',
  'task_generation',
  'knowledge_check_generation',
  'roadmap_plan',
  'daily_plan',
  'predicted_score',
  'mock_analysis',
  'assistant_chat',
  'moderation'
);

create type public.ai_job_status as enum (
  'queued','running','awaiting_retry','succeeded','failed','canceled','dead_letter'
);

create type public.stat_source_type as enum (
  'attempt','mock_attempt','lesson_progress','manual','system_recalc'
);
