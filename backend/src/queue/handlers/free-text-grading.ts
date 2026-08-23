import { gradeFreeText, type GradedAnswer, type GradingCandidate } from '../../ai/ops/grading.js';
import { roundTo } from '../../contracts/domain.js';
import type { SqlExecutor } from '../../db/sql.js';
import {
  findAttempt,
  loadAttemptAnswers,
  loadAttemptQuestions,
  type AttemptQuestion,
  type StoredAnswer,
} from '../../modules/attempts/queries.js';
import { parseAnswerKey } from '../../modules/attempts/grading.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../types.js';
import { requireAttemptId } from './attempt-input.js';

function expectedPointsOf(question: AttemptQuestion): string[] {
  const key = parseAnswerKey(question.answerKey);
  return key !== null && 'expected_points' in key ? [...key.expected_points] : [];
}

function toCandidates(
  questions: readonly AttemptQuestion[],
  answers: readonly StoredAnswer[],
): GradingCandidate[] {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));

  return questions
    .filter((question) => question.kind === 'free_text')
    .flatMap((question) => {
      const given = byQuestion.get(question.id);

      if (given?.grader !== 'pending') {
        return [];
      }

      const text = given.answer.text?.trim() ?? '';
      if (text === '') {
        return [];
      }

      return [
        {
          questionId: question.id,
          promptMd: question.promptMd,
          rubricMd: question.rubricMd,
          points: question.points,
          expectedPoints: expectedPointsOf(question),
          answerText: text,
        },
      ];
    });
}

async function applyGrades(
  tx: SqlExecutor,
  attemptId: string,
  graded: readonly GradedAnswer[],
): Promise<void> {
  if (graded.length === 0) {
    return;
  }

  await tx`
    update public.attempt_answers a
       set grader = 'ai',
           is_correct = item.is_correct::boolean,
           points_awarded = item.points::numeric,
           ai_feedback_md = item.feedback,
           ai_confidence = item.confidence::numeric
      from unnest(
             ${graded.map((answer) => answer.questionId)}::text[],
             ${graded.map((answer) => String(answer.isCorrect))}::text[],
             ${graded.map((answer) => String(answer.pointsAwarded))}::text[],
             ${graded.map((answer) => answer.feedbackMd)}::text[],
             ${graded.map((answer) => String(answer.confidence))}::text[]
           ) as item(question_id, is_correct, points, feedback, confidence)
     where a.attempt_id = ${attemptId}
       and a.question_id = item.question_id::uuid
  `;

  await tx`
    update public.attempts a
       set raw_score = coalesce((
             select sum(aa.points_awarded)
               from public.attempt_answers aa
              where aa.attempt_id = a.id and aa.points_awarded is not null
           ), 0)
     where a.id = ${attemptId}
  `;
}

export const freeTextGrading: JobHandler = async (ctx) => {
  const attemptId = requireAttemptId(ctx.job.input);
  const attempt = await findAttempt(ctx.sql, attemptId);

  if (attempt === null) {
    throw new PermanentJobError('попытка удалена', 'ATTEMPT_GONE');
  }

  const [questions, answers] = await Promise.all([
    loadAttemptQuestions(ctx.sql, attempt.assessmentId),
    loadAttemptAnswers(ctx.sql, attempt.id),
  ]);

  const candidates = toCandidates(questions, answers);
  const caller = await ctx.model();

  if (caller === null || candidates.length === 0) {
    return ctx.applyOnce(async () => ({
      source: 'fallback',
      graded: [],
      pending_question_ids: candidates.map((candidate) => candidate.questionId),
      note:
        candidates.length === 0
          ? 'свободных ответов, ожидающих оценки, нет'
          : 'модель недоступна: свободные ответы остаются на проверке',
    }));
  }

  const outcome = await gradeFreeText(caller, candidates);
  await ctx.logCalls(outcome.calls);

  if (outcome.answers === null) {
    if (outcome.failure === 'unavailable' && ctx.retryOnModelOutage()) {
      throw new TransientJobError(`провайдер недоступен: ${outcome.reason ?? ''}`);
    }

    ctx.log.warn(
      { job_id: ctx.job.id, failure: outcome.failure, reason: outcome.reason },
      'оценивание свободных ответов не выполнено, ответы остаются на проверке',
    );

    return ctx.applyOnce(async () => ({
      source: 'fallback',
      graded: [],
      pending_question_ids: candidates.map((candidate) => candidate.questionId),
      note: outcome.reason ?? 'модель не вернула оценку',
    }));
  }

  if (outcome.lowTrustCount > 0) {
    ctx.log.warn(
      {
        job_id: ctx.job.id,
        low_trust: outcome.lowTrustCount,
        suspicious: outcome.suspiciousCount,
      },
      'оценка получила пониженное доверие',
    );
  }

  const graded = outcome.answers;

  return ctx.applyOnce(async (tx) => {
    await applyGrades(tx, attempt.id, graded);

    return {
      source: 'ai',
      graded: graded.map((answer) => ({
        question_id: answer.questionId,
        points_awarded: roundTo(answer.pointsAwarded, 2),
        is_correct: answer.isCorrect,
        confidence: answer.confidence,
        low_trust: answer.lowTrust,
      })),
      pending_question_ids: candidates
        .filter((candidate) => !graded.some((answer) => answer.questionId === candidate.questionId))
        .map((candidate) => candidate.questionId),
      low_trust_count: outcome.lowTrustCount,
      suspicious_count: outcome.suspiciousCount,
    };
  });
};
