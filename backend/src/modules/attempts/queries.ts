import { z } from 'zod';

import type { AnswerPayload } from '../../contracts/dto/attempts.js';
import { answerPayloadSchema } from '../../contracts/dto/attempts.js';
import { questionKindSchema, type AttemptStatus, type QuestionKind } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import type { SqlExecutor } from '../../db/sql.js';
import { parseAnswerKey, type AnswerKey } from './grading.js';


export interface AttemptRow {
  readonly id: string;
  readonly studentId: string;
  readonly assessmentId: string;
  readonly status: AttemptStatus;
  readonly kind: string;
  readonly title: string;
  readonly startedAt: Date;
  readonly submittedAt: Date | null;
  readonly gradedAt: Date | null;
  readonly deadlineAt: Date | null;
  readonly timeLimitSec: number | null;
  readonly timeSpentSec: number;
  readonly rawScore: number | null;
  readonly maxScore: number | null;
  readonly scorePct: number | null;
  readonly gradingJobId: string | null;
  readonly analysisJobId: string | null;
}

interface AttemptDbRow {
  id: string;
  student_id: string;
  assessment_id: string;
  status: AttemptStatus;
  kind: string;
  title: string;
  started_at: Date;
  submitted_at: Date | null;
  graded_at: Date | null;
  deadline_at: Date | null;
  time_limit_sec: number | null;
  time_spent_sec: number;
  raw_score: string | null;
  max_score: string | null;
  score_pct: string | null;
  grading_job_id: string | null;
  analysis_job_id: string | null;
}

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function mapAttempt(row: AttemptDbRow): AttemptRow {
  return {
    id: row.id,
    studentId: row.student_id,
    assessmentId: row.assessment_id,
    status: row.status,
    kind: row.kind,
    title: row.title,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    gradedAt: row.graded_at,
    deadlineAt: row.deadline_at,
    timeLimitSec: row.time_limit_sec,
    timeSpentSec: row.time_spent_sec,
    rawScore: toNumber(row.raw_score),
    maxScore: toNumber(row.max_score),
    scorePct: toNumber(row.score_pct),
    gradingJobId: row.grading_job_id,
    analysisJobId: row.analysis_job_id,
  };
}

export async function findAttempt(
  sql: SqlExecutor,
  attemptId: string,
): Promise<AttemptRow | null> {
  const rows = await sql<AttemptDbRow[]>`
    select a.id, a.student_id, a.assessment_id, a.status::text as status,
           s.kind::text as kind, s.title, s.time_limit_sec,
           a.started_at, a.submitted_at, a.graded_at, a.deadline_at,
           a.time_spent_sec, a.raw_score, a.max_score, a.score_pct,
           a.grading_job_id, a.analysis_job_id
      from public.attempts a
      join public.assessments s on s.id = a.assessment_id
     where a.id = ${attemptId}
  `;

  const row = rows[0];
  return row === undefined ? null : mapAttempt(row);
}

export async function lockAttempt(
  sql: SqlExecutor,
  attemptId: string,
): Promise<AttemptRow | null> {
  const rows = await sql<AttemptDbRow[]>`
    select a.id, a.student_id, a.assessment_id, a.status::text as status,
           s.kind::text as kind, s.title, s.time_limit_sec,
           a.started_at, a.submitted_at, a.graded_at, a.deadline_at,
           a.time_spent_sec, a.raw_score, a.max_score, a.score_pct,
           a.grading_job_id, a.analysis_job_id
      from public.attempts a
      join public.assessments s on s.id = a.assessment_id
     where a.id = ${attemptId}
     for no key update of a
  `;

  const row = rows[0];
  return row === undefined ? null : mapAttempt(row);
}

export async function requireOwnAttempt(
  sql: SqlExecutor,
  attemptId: string,
  studentId: string,
): Promise<AttemptRow> {
  const attempt = await findAttempt(sql, attemptId);

  if (attempt?.studentId !== studentId) {
    throw new AppError('NOT_FOUND', { message: 'Попытка не найдена' });
  }

  return attempt;
}


const optionsSchema = z
  .array(z.object({ id: z.string(), text_md: z.string() }))
  .nullable();

export interface AttemptQuestion {
  readonly id: string;
  readonly position: number;
  readonly kind: QuestionKind;
  readonly promptMd: string;
  readonly options: { id: string; text_md: string }[] | null;
  readonly points: number;
  readonly difficulty: number;
  readonly answerKey: AnswerKey | null;
  readonly rubricMd: string | null;
  readonly explanationMd: string | null;
  readonly topicId: string;
  readonly topicTitle: string;
  readonly subjectId: string;
  readonly subjectCode: string;
  readonly subjectName: string;
}

interface QuestionDbRow {
  id: string;
  position: number;
  kind: string;
  prompt_md: string;
  options: unknown;
  answer_key: unknown;
  points: string;
  difficulty: number;
  rubric_md: string | null;
  explanation_md: string | null;
  topic_id: string;
  topic_title: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
}

export async function loadAttemptQuestions(
  sql: SqlExecutor,
  assessmentId: string,
): Promise<AttemptQuestion[]> {
  const rows = await sql<QuestionDbRow[]>`
    select q.id, aq.position, q.kind::text as kind, q.prompt_md, q.options, q.answer_key,
           coalesce(aq.points_override, q.points) as points, q.difficulty,
           q.rubric_md, q.explanation_md,
           q.topic_id, t.title_ru as topic_title,
           q.subject_id, s.code as subject_code, s.name_ru as subject_name
      from public.assessment_questions aq
      join public.questions q on q.id = aq.question_id
      join public.topics t on t.id = q.topic_id
      join public.subjects s on s.id = q.subject_id
     where aq.assessment_id = ${assessmentId}
     order by aq.position
  `;

  return rows.map((row) => {
    const options = optionsSchema.safeParse(row.options);

    return {
      id: row.id,
      position: row.position,
      kind: questionKindSchema.parse(row.kind),
      promptMd: row.prompt_md,
      options: options.success ? options.data : null,
      points: Number(row.points),
      difficulty: row.difficulty,
      answerKey: parseAnswerKey(row.answer_key),
      rubricMd: row.rubric_md,
      explanationMd: row.explanation_md,
      topicId: row.topic_id,
      topicTitle: row.topic_title,
      subjectId: row.subject_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
    };
  });
}


export interface StoredAnswer {
  readonly questionId: string;
  readonly answer: AnswerPayload;
  readonly timeSpentSec: number;
  readonly answeredAt: Date;
  readonly grader: 'deterministic' | 'ai' | 'pending';
  readonly isCorrect: boolean | null;
  readonly pointsAwarded: number | null;
  readonly aiFeedbackMd: string | null;
  readonly aiConfidence: number | null;
}

interface AnswerDbRow {
  question_id: string;
  answer: unknown;
  time_spent_sec: number;
  answered_at: Date;
  grader: 'deterministic' | 'ai' | 'pending';
  is_correct: boolean | null;
  points_awarded: string | null;
  ai_feedback_md: string | null;
  ai_confidence: string | null;
}

export async function loadAttemptAnswers(
  sql: SqlExecutor,
  attemptId: string,
): Promise<StoredAnswer[]> {
  const rows = await sql<AnswerDbRow[]>`
    select question_id, answer, time_spent_sec, answered_at,
           grader::text as grader, is_correct, points_awarded, ai_feedback_md, ai_confidence
      from public.attempt_answers
     where attempt_id = ${attemptId}
  `;

  const answers: StoredAnswer[] = [];

  for (const row of rows) {
    const parsed = answerPayloadSchema.safeParse(row.answer);
    if (!parsed.success) {
      continue;
    }

    answers.push({
      questionId: row.question_id,
      answer: parsed.data,
      timeSpentSec: row.time_spent_sec,
      answeredAt: row.answered_at,
      grader: row.grader,
      isCorrect: row.is_correct,
      pointsAwarded: toNumber(row.points_awarded),
      aiFeedbackMd: row.ai_feedback_md,
      aiConfidence: toNumber(row.ai_confidence),
    });
  }

  return answers;
}
