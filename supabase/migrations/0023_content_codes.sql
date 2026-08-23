alter table public.questions   add column content_code text;
alter table public.lessons     add column content_code text;
alter table public.materials   add column content_code text;
alter table public.assessments add column content_code text;

create unique index questions_content_code_idx
  on public.questions(content_code) where content_code is not null;
create unique index lessons_content_code_idx
  on public.lessons(content_code) where content_code is not null;
create unique index materials_content_code_idx
  on public.materials(content_code) where content_code is not null;
create unique index assessments_content_code_idx
  on public.assessments(content_code) where content_code is not null;

comment on column public.questions.content_code is
  'Код записи в файлах наполнения (supabase/content). Пусто у сгенерированных ИИ вопросов.';

delete from public.assessment_questions
 where assessment_id in (select id from public.assessments where kind = 'exam_mock');
delete from public.assessments where kind = 'exam_mock' and content_code is null;
delete from public.questions where origin = 'bank' and content_code is null;
