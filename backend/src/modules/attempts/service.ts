import type {
  AttemptResult,
  AttemptView,
  DiagnosticState,
  JobRef,
  SaveAnswersRequest,
  StartAttemptRequest,
  SubmitResponse,
} from '../../contracts/dto/attempts.js';
import { FREE_TEXT_MAX_CHARS } from '../../contracts/dto/attempts.js';
import { z } from 'zod';

import { roundTo } from '../../contracts/domain.js';
import { isJsonObject } from '../../contracts/json.js';
import { AppError } from '../../contracts/errors.js';
import { writeAudit } from '../../db/audit.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import {
  dedupeKey,
  enqueueJob,
  isTerminal,
  pollUrl,
  SUGGESTED_WAIT_MS,
  type AiJobStatus,
  type AiOpType,
  type EnqueuedJob,
} from '../../queue/jobs.js';
import type { AuthUser } from '../../types/fastify.js';
import { mockScoreFor } from '../mocks/service.js';
import {
  assertAnswerShape,
  gradeAnswer,
  SKIPPED,
  summarize,
  type ScoredQuestion,
} from './grading.js';
import {
  findAttempt,
  loadAttemptAnswers,
  loadAttemptQuestions,
  lockAttempt,
  requireOwnAttempt,
  type AttemptQuestion,
  type AttemptRow,
  type StoredAnswer,
} from './queries.js';

const MAX_TIME_SPENT_SEC = 43_200;

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function jobRef(job: EnqueuedJob): JobRef {
  return {
    id: job.id,
    op_type: job.opType,
    status: job.status,
    poll_url: pollUrl(job.id),
    suggested_wait_ms: SUGGESTED_WAIT_MS[job.opType],
  };
}

interface AssessmentRow {
  id: string;
  kind: string;
  title: string;
  student_id: string | null;
  time_limit_sec: number | null;
  is_active: boolean;
  question_count: number;
}

async function loadAssessment(
  sql: SqlExecutor,
  assessmentId: string,
  studentId: string,
): Promise<AssessmentRow> {
  const [row] = await sql<AssessmentRow[]>`
    select s.id, s.kind::text as kind, s.title, s.student_id, s.time_limit_sec, s.is_active,
           (select count(*) from public.assessment_questions aq
             where aq.assessment_id = s.id)::int as question_count
      from public.assessments s
     where s.id = ${assessmentId}
  `;

  
  if (row === undefined || (row.student_id !== null && row.student_id !== studentId)) {
    throw new AppError('NOT_FOUND', { message: 'Тест не найден' });
  }

  if (!row.is_active) {
    throw new AppError('STATE_CONFLICT', { message: 'Тест больше не активен' });
  }

  if (row.question_count === 0) {
    throw new AppError('STATE_CONFLICT', { message: 'В тесте нет вопросов' });
  }

  return row;
}

async function assertDiagnosticNotTaken(
  sql: SqlExecutor,
  assessmentId: string,
  studentId: string,
): Promise<void> {
  const [taken] = await sql<{ id: string }[]>`
    select id from public.attempts
     where assessment_id = ${assessmentId}
       and student_id = ${studentId}
       and status in ('submitted','grading','graded','failed')
     limit 1
  `;

  if (taken !== undefined) {
    throw new AppError('STATE_CONFLICT', {
      message: 'Диагностический тест проходится один раз',
      details: { attempt_id: taken.id },
    });
  }
}

export async function startAttempt(
  sql: Sql,
  user: AuthUser,
  body: StartAttemptRequest,
  requestId: string,
): Promise<AttemptView> {
  const attemptId = await sql.begin(async (tx) => {
    const assessment = await loadAssessment(tx, body.assessment_id, user.id);

    
    
    const [existing] = await tx<{ id: string }[]>`
      select id from public.attempts
       where student_id = ${user.id}
         and (
           (assessment_id = ${assessment.id} and status = 'in_progress')
           or (${body.client_attempt_id}::text is not null
               and client_attempt_id = ${body.client_attempt_id})
         )
       order by started_at desc
       limit 1
    `;

    if (existing !== undefined) {
      return existing.id;
    }

    if (assessment.kind === 'diagnostic') {
      await assertDiagnosticNotTaken(tx, assessment.id, user.id);
    }

    
    
    const [created] = await tx<{ id: string }[]>`
      insert into public.attempts (student_id, assessment_id, client_attempt_id, deadline_at)
      values (
        ${user.id},
        ${assessment.id},
        ${body.client_attempt_id},
        case when ${assessment.time_limit_sec}::int is null then null
             else now() + make_interval(secs => ${assessment.time_limit_sec}::int) end
      )
      returning id
    `;

    if (created === undefined) {
      throw new AppError('INTERNAL_ERROR', { message: 'Не удалось создать попытку' });
    }

    await writeAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'attempt.start',
      entityType: 'attempt',
      entityId: created.id,
      summary: { assessment_kind: assessment.kind },
      requestId,
    });

    return created.id;
  });

  return getAttempt(sql, user, attemptId);
}

function toQuestionView(question: AttemptQuestion): AttemptView['questions'][number] {
  return {
    id: question.id,
    position: question.position,
    kind: question.kind,
    prompt_md: question.promptMd,
    options: question.options,
    points: question.points,
    difficulty: question.difficulty,
    max_chars: question.kind === 'free_text' ? FREE_TEXT_MAX_CHARS : null,
    subject: { code: question.subjectCode, name: question.subjectName },
    topic: { id: question.topicId, title: question.topicTitle },
  };
}

export async function getAttempt(
  sql: Sql,
  user: AuthUser,
  attemptId: string,
): Promise<AttemptView> {
  const attempt = await requireOwnAttempt(sql, attemptId, user.id);
  const [questions, answers] = await Promise.all([
    loadAttemptQuestions(sql, attempt.assessmentId),
    loadAttemptAnswers(sql, attempt.id),
  ]);

  return {
    attempt: {
      id: attempt.id,
      assessment_id: attempt.assessmentId,
      kind: attempt.kind,
      title: attempt.title,
      status: attempt.status,
      started_at: attempt.startedAt.toISOString(),
      submitted_at: isoOrNull(attempt.submittedAt),
      deadline_at: isoOrNull(attempt.deadlineAt),
      time_limit_sec: attempt.timeLimitSec,
      time_spent_sec: attempt.timeSpentSec,
      answered_count: answers.length,
      total_count: questions.length,
    },
    
    
    questions: questions.map(toQuestionView),
    answers: answers.map((answer) => ({
      question_id: answer.questionId,
      answer: answer.answer,
      time_spent_sec: answer.timeSpentSec,
      answered_at: answer.answeredAt.toISOString(),
    })),
    server_time: new Date().toISOString(),
  };
}

export async function saveAnswers(
  sql: Sql,
  user: AuthUser,
  attemptId: string,
  body: SaveAnswersRequest,
): Promise<{
  saved: number;
  answered_count: number;
  total_count: number;
  server_time: string;
}> {
  const attempt = await requireOwnAttempt(sql, attemptId, user.id);

  if (attempt.status !== 'in_progress') {
    throw new AppError('ATTEMPT_ALREADY_SUBMITTED');
  }

  const questions = await loadAttemptQuestions(sql, attempt.assessmentId);
  const byId = new Map(questions.map((question) => [question.id, question]));

  for (const item of body.answers) {
    const question = byId.get(item.question_id);
    if (question === undefined) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'Вопрос не относится к этой попытке',
        details: { question_id: item.question_id },
      });
    }
    assertAnswerShape(question.kind, item.answer);
  }

  await sql.begin(async (tx) => {
    
    
    const locked = await lockAttempt(tx, attempt.id);
    if (locked?.status !== 'in_progress') {
      throw new AppError('ATTEMPT_ALREADY_SUBMITTED');
    }

    
    
    await tx`
      insert into public.attempt_answers (attempt_id, question_id, answer, time_spent_sec)
      select ${attempt.id}, item.question_id::uuid, item.answer::jsonb, item.seconds
        from unnest(
               ${body.answers.map((item) => item.question_id)}::text[],
               ${body.answers.map((item) => JSON.stringify(item.answer))}::text[],
               ${body.answers.map((item) => item.time_spent_sec)}::int[]
             ) as item(question_id, answer, seconds)
      on conflict (attempt_id, question_id) do update set
        answer         = excluded.answer,
        time_spent_sec = greatest(public.attempt_answers.time_spent_sec, excluded.time_spent_sec),
        answered_at    = now(),
        grader         = 'pending',
        is_correct     = null,
        points_awarded = null
    `;
  });

  const [counts] = await sql<{ answered: number; total: number }[]>`
    select
      (select count(*) from public.attempt_answers where attempt_id = ${attempt.id})::int as answered,
      (select count(*) from public.assessment_questions
        where assessment_id = ${attempt.assessmentId})::int as total
  `;

  return {
    saved: body.answers.length,
    answered_count: counts?.answered ?? 0,
    total_count: counts?.total ?? 0,
    server_time: new Date().toISOString(),
  };
}

function analysisOpFor(kind: string): AiOpType {
  switch (kind) {
    case 'diagnostic':
      return 'diagnostic_analysis';
    case 'exam_mock':
      return 'mock_analysis';
    default:
      return 'attempt_analysis';
  }
}

function analysisDedupeKey(kind: string, attemptId: string): string {
  switch (kind) {
    case 'diagnostic':
      return dedupeKey.diagnosticAnalysis(attemptId);
    case 'exam_mock':
      return dedupeKey.mockAnalysis(attemptId);
    default:
      return dedupeKey.attemptAnalysis(attemptId);
  }
}

function score(
  questions: readonly AttemptQuestion[],
  answers: readonly StoredAnswer[],
): ScoredQuestion[] {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));

  return questions.map((question) => {
    const given = byQuestion.get(question.id);
    const outcome = given === undefined ? SKIPPED : gradeAnswer(question, given.answer);

    return {
      id: question.id,
      kind: question.kind,
      points: question.points,
      answerKey: question.answerKey,
      topicId: question.topicId,
      subjectId: question.subjectId,
      outcome,
    };
  });
}

function elapsedSeconds(startedAt: Date, until: Date): number {
  const seconds = Math.floor((until.getTime() - startedAt.getTime()) / 1000);
  return Math.min(MAX_TIME_SPENT_SEC, Math.max(0, seconds));
}

export interface SubmitOptions {
  readonly requestId?: string;
  
  readonly finalize?: (tx: SqlExecutor, status: number, body: unknown) => Promise<void>;
  
  readonly automatic?: boolean;
}

export async function submitAttempt(
  sql: Sql,
  user: Pick<AuthUser, 'id' | 'role'>,
  attemptId: string,
  options: SubmitOptions = {},
): Promise<SubmitResponse> {
  const known = await requireOwnAttempt(sql, attemptId, user.id);

  return sql.begin(async (tx) => {
    const attempt = await lockAttempt(tx, known.id);

    if (attempt === null) {
      throw new AppError('NOT_FOUND', { message: 'Попытка не найдена' });
    }
    if (attempt.status === 'abandoned') {
      throw new AppError('STATE_CONFLICT', { message: 'Попытка была брошена' });
    }
    if (attempt.status !== 'in_progress') {
      throw new AppError('ATTEMPT_ALREADY_SUBMITTED');
    }

    const [questions, answers] = await Promise.all([
      loadAttemptQuestions(tx, attempt.assessmentId),
      loadAttemptAnswers(tx, attempt.id),
    ]);

    const scored = score(questions, answers);
    const summary = summarize(scored);
    const submittedAt = new Date();

    const graded = scored.filter((question) => question.outcome.grader === 'deterministic');

    if (graded.length > 0) {
      
      
      await tx`
        update public.attempt_answers a
           set grader = 'deterministic',
               is_correct = item.is_correct::boolean,
               points_awarded = item.points::numeric
          from unnest(
                 ${graded.map((question) => question.id)}::text[],
                 ${graded.map((question) => String(question.outcome.isCorrect))}::text[],
                 ${graded.map((question) => String(question.outcome.pointsAwarded))}::text[]
               ) as item(question_id, is_correct, points)
         where a.attempt_id = ${attempt.id}
           and a.question_id = item.question_id::uuid
      `;
    }

    await tx`
      update public.attempts
         set status         = 'grading',
             submitted_at   = ${submittedAt},
             raw_score      = ${summary.rawScore},
             max_score      = ${summary.maxScore},
             time_spent_sec = ${elapsedSeconds(attempt.startedAt, submittedAt)}
       where id = ${attempt.id}
    `;

    
    
    let gradingJob: EnqueuedJob | null = null;
    if (summary.pendingQuestions > 0) {
      gradingJob = await enqueueJob(tx, {
        opType: 'free_text_grading',
        requestedBy: user.id,
        studentId: user.id,
        dedupeKey: dedupeKey.freeTextGrading(attempt.id),
        input: { attempt_id: attempt.id },
      });
    }

    const analysisJob = await enqueueJob(tx, {
      opType: analysisOpFor(attempt.kind),
      requestedBy: user.id,
      studentId: user.id,
      dedupeKey: analysisDedupeKey(attempt.kind, attempt.id),
      dependsOnJobId: gradingJob?.id ?? null,
      input: { attempt_id: attempt.id },
    });

    await tx`
      update public.attempts
         set grading_job_id = ${gradingJob?.id ?? null}, analysis_job_id = ${analysisJob.id}
       where id = ${attempt.id}
    `;

    
    
    const automatic = options.automatic === true;

    await writeAudit(tx, {
      ...(automatic ? {} : { actorId: user.id, actorRole: user.role }),
      action: automatic ? 'attempt.autosubmit' : 'attempt.submit',
      entityType: 'attempt',
      entityId: attempt.id,
      summary: {
        student_id: attempt.studentId,
        raw_score: summary.rawScore,
        max_score: summary.maxScore,
        pending: summary.pendingQuestions,
      },
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    });

    const response: SubmitResponse = {
      attempt: {
        id: attempt.id,
        status: 'grading',
        deterministic: {
          raw_score: summary.rawScore,
          max_score: summary.maxScore,
          graded_questions: summary.gradedQuestions,
        },
        pending_ai_questions: summary.pendingQuestions,
      },
      job: jobRef(gradingJob ?? analysisJob),
    };

    await options.finalize?.(tx, 202, response);
    return response;
  });
}

export async function abandonAttempt(
  sql: Sql,
  user: AuthUser,
  attemptId: string,
  requestId: string,
): Promise<{ id: string; status: 'abandoned' }> {
  const attempt = await requireOwnAttempt(sql, attemptId, user.id);

  if (attempt.status === 'abandoned') {
    return { id: attempt.id, status: 'abandoned' };
  }
  if (attempt.status !== 'in_progress') {
    throw new AppError('ATTEMPT_ALREADY_SUBMITTED');
  }

  await sql.begin(async (tx) => {
    const locked = await lockAttempt(tx, attempt.id);
    if (locked?.status !== 'in_progress') {
      throw new AppError('ATTEMPT_ALREADY_SUBMITTED');
    }

    await tx`update public.attempts set status = 'abandoned' where id = ${attempt.id}`;

    await writeAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'attempt.abandon',
      entityType: 'attempt',
      entityId: attempt.id,
      requestId,
    });
  });

  return { id: attempt.id, status: 'abandoned' };
}

interface TopicStatRow {
  topic_id: string;
  delta_pct: string;
  observed_pct: string | null;
  mastery_pct: string | null;
}

interface JobStateRow {
  id: string;
  op_type: AiOpType;
  status: AiJobStatus;
  result: unknown;
}

function jobStatus(job: JobStateRow): AiJobStatus {
  return job.status;
}

async function loadJobState(sql: SqlExecutor, jobId: string | null): Promise<JobStateRow | null> {
  if (jobId === null) {
    return null;
  }
  const [row] = await sql<JobStateRow[]>`
    select id, op_type::text as op_type, status::text as status, result
      from public.ai_jobs where id = ${jobId}
  `;
  return row ?? null;
}

export async function getAttemptResult(
  sql: Sql,
  user: AuthUser,
  attemptId: string,
): Promise<AttemptResult> {
  const attempt = await requireOwnAttempt(sql, attemptId, user.id);

  if (attempt.status === 'in_progress') {
    throw new AppError('STATE_CONFLICT', {
      message: 'Попытка ещё не отправлена',
      details: { attempt_id: attempt.id },
    });
  }
  if (attempt.status === 'abandoned') {
    throw new AppError('STATE_CONFLICT', { message: 'Попытка была брошена' });
  }

  const [questions, answers, stats] = await Promise.all([
    loadAttemptQuestions(sql, attempt.assessmentId),
    loadAttemptAnswers(sql, attempt.id),
    sql<TopicStatRow[]>`
      select e.topic_id, e.delta_pct, e.observed_pct, m.mastery_pct
        from public.stat_events e
        left join public.student_topic_mastery m
               on m.student_id = e.student_id and m.topic_id = e.topic_id
       where e.student_id = ${user.id}
         and e.source_id = ${attempt.id}
         and e.source_type in ('attempt','mock_attempt')
    `,
  ]);

  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const statByTopic = new Map(stats.map((stat) => [stat.topic_id, stat]));

  const topicTotals = new Map<
    string,
    { title: string; subjectCode: string; earned: number; possible: number }
  >();
  const subjectTotals = new Map<
    string,
    { code: string; name: string; earned: number; possible: number }
  >();

  let pending = 0;

  const review: AttemptResult['answers'] = questions.map((question) => {
    const given = byQuestion.get(question.id);
    const isPending = given?.grader === 'pending';

    if (isPending) {
      pending += 1;
    } else {
      const earned = given?.pointsAwarded ?? 0;

      const topic = topicTotals.get(question.topicId) ?? {
        title: question.topicTitle,
        subjectCode: question.subjectCode,
        earned: 0,
        possible: 0,
      };
      topic.earned += earned;
      topic.possible += question.points;
      topicTotals.set(question.topicId, topic);

      const subject = subjectTotals.get(question.subjectCode) ?? {
        code: question.subjectCode,
        name: question.subjectName,
        earned: 0,
        possible: 0,
      };
      subject.earned += earned;
      subject.possible += question.points;
      subjectTotals.set(question.subjectCode, subject);
    }

    return {
      question_id: question.id,
      position: question.position,
      kind: question.kind,
      prompt_md: question.promptMd,
      options: question.options,
      your_answer: given?.answer ?? null,
      
      
      correct_answer: revealAnswerKey(question),
      is_correct: given?.isCorrect ?? null,
      points: question.points,
      
      points_awarded: given === undefined ? 0 : given.pointsAwarded,
      grader: given?.grader ?? 'deterministic',
      explanation_md: question.explanationMd,
      ai_feedback_md: given?.aiFeedbackMd ?? null,
    };
  });

  const topics: AttemptResult['topics'] = [...topicTotals.entries()].map(([topicId, totals]) => {
    const stat = statByTopic.get(topicId);
    const pct = totals.possible === 0 ? 0 : roundTo((totals.earned / totals.possible) * 100, 2);

    return {
      topic_id: topicId,
      title: totals.title,
      subject_code: totals.subjectCode,
      points_earned: roundTo(totals.earned, 2),
      points_possible: roundTo(totals.possible, 2),
      pct,
      mastery_pct: stat?.mastery_pct === undefined || stat.mastery_pct === null
        ? null
        : Number(stat.mastery_pct),
      delta_pct: stat === undefined ? null : Number(stat.delta_pct),
    };
  });

  const sortedByPct = [...topics].sort((left, right) => left.pct - right.pct);
  const analysisJob = await loadJobState(sql, attempt.analysisJobId);
  const gradingJob = await loadJobState(sql, attempt.gradingJobId);

  
  
  const unfinished = [gradingJob, analysisJob].find(
    (job): job is JobStateRow => job !== null && !isTerminal(jobStatus(job)),
  ) ?? null;

  return {
    attempt: {
      id: attempt.id,
      assessment_id: attempt.assessmentId,
      kind: attempt.kind,
      title: attempt.title,
      status: attempt.status,
      submitted_at: isoOrNull(attempt.submittedAt),
      graded_at: isoOrNull(attempt.gradedAt),
      raw_score: attempt.rawScore,
      max_score: attempt.maxScore,
      score_pct: attempt.scorePct,
      time_spent_sec: attempt.timeSpentSec,
      pending_questions: pending,
    },
    subjects: [...subjectTotals.values()].map((subject) => ({
      code: subject.code,
      name: subject.name,
      points_earned: roundTo(subject.earned, 2),
      points_possible: roundTo(subject.possible, 2),
      pct: subject.possible === 0 ? 0 : roundTo((subject.earned / subject.possible) * 100, 2),
    })),
    topics,
    
    
    strengths: storedHighlights(analysisJob, 'strengths') ?? fallbackStrengths(sortedByPct),
    focus: storedHighlights(analysisJob, 'focus') ?? fallbackFocus(sortedByPct),
    answers: review,
    analysis: buildAnalysis(attempt, analysisJob),
    
    
    
    exam: await mockScoreFor(sql, user.id, attempt.id),
    job:
      unfinished === null
        ? null
        : {
            id: unfinished.id,
            op_type: unfinished.op_type,
            status: unfinished.status,
            poll_url: pollUrl(unfinished.id),
            suggested_wait_ms: SUGGESTED_WAIT_MS[unfinished.op_type],
          },
  };
}

const storedHighlightsSchema = z.array(
  z.object({
    topic_id: z.uuid(),
    title: z.string(),
    pct: z.number(),
    note: z.string().nullable().default(null),
  }),
);

function storedHighlights(
  job: JobStateRow | null,
  field: 'strengths' | 'focus',
): AttemptResult['strengths'] | null {
  if (job === null || !isJsonObject(job.result)) {
    return null;
  }

  const parsed = storedHighlightsSchema.safeParse(job.result[field]);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

type TopicResult = AttemptResult['topics'][number];

function fallbackStrengths(sortedByPct: readonly TopicResult[]): AttemptResult['strengths'] {
  return sortedByPct
    .filter((topic) => topic.pct >= 70)
    .slice(-3)
    .reverse()
    .map((topic) => ({ topic_id: topic.topic_id, title: topic.title, pct: topic.pct, note: null }));
}

function fallbackFocus(sortedByPct: readonly TopicResult[]): AttemptResult['focus'] {
  return sortedByPct
    .filter((topic) => topic.pct < 60)
    .slice(0, 3)
    .map((topic) => ({ topic_id: topic.topic_id, title: topic.title, pct: topic.pct, note: null }));
}

function revealAnswerKey(question: AttemptQuestion): AttemptResult['answers'][number]['correct_answer'] {
  const key = question.answerKey;
  if (key === null) {
    return null;
  }
  if ('correct' in key) {
    return { selected: key.correct };
  }
  if ('value' in key) {
    return { value: key.value };
  }
  return { expected_points: key.expected_points };
}

function buildAnalysis(
  attempt: AttemptRow,
  job: JobStateRow | null,
): AttemptResult['analysis'] {
  if (job?.status !== 'succeeded' || attempt.gradedAt === null) {
    return null;
  }

  const result = job.result;
  const source =
    typeof result === 'object' && result !== null && 'source' in result && result.source === 'ai'
      ? 'ai'
      : 'fallback';
  const summaryMd =
    typeof result === 'object' &&
    result !== null &&
    'summary_md' in result &&
    typeof result.summary_md === 'string'
      ? result.summary_md
      : null;

  return { source, summary_md: summaryMd, computed_at: attempt.gradedAt.toISOString() };
}

export async function getDiagnosticState(sql: Sql, user: AuthUser): Promise<DiagnosticState> {
  const [profile] = await sql<{ onboarding_completed_at: Date | null }[]>`
    select onboarding_completed_at from public.student_profiles where student_id = ${user.id}
  `;

  if (profile?.onboarding_completed_at == null) {
    return {
      state: 'not_assigned',
      assessment: null,
      attempt: null,
      empty_reason: 'onboarding_incomplete',
    };
  }

  const [assessment] = await sql<{
    id: string;
    title: string;
    time_limit_sec: number | null;
    total_points: string;
  }[]>`
    select id, title, time_limit_sec, total_points
      from public.assessments
     where student_id = ${user.id} and kind = 'diagnostic' and is_active
     order by created_at
     limit 1
  `;

  if (assessment === undefined) {
    return {
      state: 'not_assigned',
      assessment: null,
      attempt: null,
      empty_reason: 'not_enough_questions',
    };
  }

  const composition = await sql<
    { subject_code: string; subject_name: string; kind: string; n: number }[]
  >`
    select s.code as subject_code, s.name_ru as subject_name, q.kind::text as kind,
           count(*)::int as n
      from public.assessment_questions aq
      join public.questions q on q.id = aq.question_id
      join public.subjects s on s.id = q.subject_id
     where aq.assessment_id = ${assessment.id}
     group by s.code, s.name_ru, q.kind, s.sort_order
     order by s.sort_order
  `;

  const subjects = new Map<string, { code: string; name: string; question_count: number }>();
  let questionCount = 0;
  let freeTextCount = 0;

  for (const row of composition) {
    questionCount += row.n;
    if (row.kind === 'free_text') {
      freeTextCount += row.n;
    }
    const existing = subjects.get(row.subject_code);
    if (existing === undefined) {
      subjects.set(row.subject_code, {
        code: row.subject_code,
        name: row.subject_name,
        question_count: row.n,
      });
    } else {
      existing.question_count += row.n;
    }
  }

  const [latest] = await sql<{ id: string }[]>`
    select id from public.attempts
     where student_id = ${user.id} and assessment_id = ${assessment.id}
       and status <> 'abandoned'
     order by started_at desc
     limit 1
  `;

  const attempt = latest === undefined ? null : await findAttempt(sql, latest.id);
  const answered =
    attempt === null
      ? 0
      : (
          await sql<{ n: number }[]>`
            select count(*)::int as n from public.attempt_answers where attempt_id = ${attempt.id}
          `
        )[0]?.n ?? 0;

  const state: DiagnosticState['state'] =
    attempt === null
      ? 'available'
      : attempt.status === 'in_progress'
        ? 'in_progress'
        : attempt.status === 'graded' || attempt.status === 'failed'
          ? 'completed'
          : 'grading';

  return {
    state,
    assessment: {
      id: assessment.id,
      title: assessment.title,
      question_count: questionCount,
      free_text_count: freeTextCount,
      time_limit_sec: assessment.time_limit_sec,
      total_points: Number(assessment.total_points),
      subjects: [...subjects.values()],
    },
    attempt:
      attempt === null
        ? null
        : {
            id: attempt.id,
            status: attempt.status,
            started_at: attempt.startedAt.toISOString(),
            submitted_at: isoOrNull(attempt.submittedAt),
            answered_count: answered,
            total_count: questionCount,
          },
    empty_reason: null,
  };
}
