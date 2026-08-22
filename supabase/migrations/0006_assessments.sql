create table public.questions (
  id             uuid primary key default gen_random_uuid(),
  origin         public.question_origin not null,
  kind           public.question_kind not null,
  subject_id     uuid not null references public.subjects(id) on delete restrict,
  topic_id       uuid not null references public.topics(id) on delete restrict,
  grade          smallint not null check (grade between 7 and 12),
  difficulty     smallint not null default 3 check (difficulty between 1 and 5),
  prompt_md      text not null check (char_length(prompt_md) between 3 and 4000),
  options        jsonb,
  answer_key     jsonb,
  rubric_md      text,
  explanation_md text,
  points         numeric(5,2) not null default 1 check (points > 0),
  created_by     uuid references public.profiles(id) on delete set null,
  generated_for  uuid references public.profiles(id) on delete cascade,
  source_job_id  uuid,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),

  constraint questions_mcq_needs_options check (
    kind not in ('mcq_single','mcq_multi')
    or (options is not null
        and jsonb_typeof(options) = 'array'
        and jsonb_array_length(options) between 2 and 8
        and answer_key is not null)
  ),

  constraint questions_numeric_key
    check (kind <> 'numeric' or (answer_key ? 'value')),

  constraint questions_free_text_rubric
    check (kind <> 'free_text' or rubric_md is not null),

  constraint questions_generated_owner
    check (origin = 'bank' or generated_for is not null)
);

comment on column public.questions.answer_key is
  'Эталонный ответ. Не отдаётся клиенту ни при каких условиях (RLS-политик у таблицы нет).';

create index questions_topic_idx
  on public.questions(topic_id, grade) where is_active and origin = 'bank';
create index questions_generated_for_idx
  on public.questions(generated_for) where origin = 'generated';


create table public.assessments (
  id              uuid primary key default gen_random_uuid(),
  kind            public.assessment_kind not null,
  title           text not null,
  subject_id      uuid references public.subjects(id) on delete set null,
  exam_profile_id uuid references public.exam_profiles(id) on delete set null,
  student_id      uuid references public.profiles(id) on delete cascade,
  lesson_id       uuid,                     -- FK добавляется в 0008
  grade           smallint check (grade between 7 and 12),
  time_limit_sec  integer check (time_limit_sec between 60 and 21600),
  total_points    numeric(7,2) not null default 0,
  outline         jsonb,
  is_active       boolean not null default true,
  source_job_id   uuid,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint assessments_personal check (
    (kind in ('diagnostic','ent_mock') and student_id is null)
    or (kind in ('ai_task','knowledge_check') and student_id is not null)
  ),

  constraint assessments_mock_needs_exam
    check (kind <> 'ent_mock' or exam_profile_id is not null)
);

comment on column public.assessments.outline is
  'План прохождения: [{"step":1,"kind":"intro","title":"Интро"}, ...]. Показывается до старта.';

create index assessments_student_idx on public.assessments(student_id, kind) where is_active;
create index assessments_kind_idx on public.assessments(kind) where is_active and student_id is null;

create table public.assessment_questions (
  assessment_id   uuid not null references public.assessments(id) on delete cascade,
  question_id     uuid not null references public.questions(id) on delete restrict,
  position        smallint not null check (position >= 1),
  points_override numeric(5,2) check (points_override > 0),

  primary key (assessment_id, question_id),
  constraint assessment_questions_position_unique
    unique (assessment_id, position) deferrable initially deferred
);

create index assessment_questions_order_idx on public.assessment_questions(assessment_id, position);


create table public.attempts (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.profiles(id) on delete cascade,
  assessment_id     uuid not null references public.assessments(id) on delete cascade,
  status            public.attempt_status not null default 'in_progress',
  client_attempt_id text,
  started_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  graded_at         timestamptz,
  deadline_at       timestamptz,
  time_spent_sec    integer not null default 0 check (time_spent_sec >= 0),
  raw_score         numeric(7,2) check (raw_score >= 0),
  max_score         numeric(7,2) check (max_score > 0),
  score_pct         numeric(5,2) generated always as (
                      case
                        when max_score is null or max_score = 0 then null
                        else round(least(100, greatest(0, raw_score / max_score * 100)), 2)
                      end
                    ) stored,
  grading_job_id    uuid,
  analysis_job_id   uuid,
  version           integer not null default 1,

  constraint attempts_status_times check (
    status <> 'graded' or (submitted_at is not null and graded_at is not null)
  )
);

comment on column public.attempts.client_attempt_id is
  'Идентификатор от клиента: повторный старт при обрыве связи не создаёт вторую попытку.';

create unique index attempts_one_active_idx
  on public.attempts(student_id, assessment_id) where status = 'in_progress';

create unique index attempts_client_id_idx
  on public.attempts(student_id, client_attempt_id) where client_attempt_id is not null;

create index attempts_student_recent_idx
  on public.attempts(student_id, submitted_at desc nulls last);

create index attempts_deadline_idx
  on public.attempts(deadline_at) where status = 'in_progress' and deadline_at is not null;

create trigger attempts_version
  before update on public.attempts
  for each row execute function app.bump_version();

create table public.attempt_answers (
  attempt_id     uuid not null references public.attempts(id) on delete cascade,
  question_id    uuid not null references public.questions(id) on delete restrict,
  answer         jsonb not null,
  answered_at    timestamptz not null default now(),
  time_spent_sec integer not null default 0 check (time_spent_sec >= 0),
  grader         public.grader_kind not null default 'pending',
  is_correct     boolean,
  points_awarded numeric(5,2) check (points_awarded >= 0),
  ai_feedback_md text,
  ai_confidence  numeric(3,2) check (ai_confidence between 0 and 1),

  primary key (attempt_id, question_id)
);

comment on column public.attempt_answers.grader is
  'Кто выставил балл: детерминированная проверка, модель, либо ещё ожидается.';

create index attempt_answers_pending_idx
  on public.attempt_answers(attempt_id) where grader = 'pending';

-- внешний ключ с 0003
alter table public.student_profiles
  add constraint student_profiles_diagnostic_fk
  foreign key (diagnostic_attempt_id) references public.attempts(id) on delete set null;
