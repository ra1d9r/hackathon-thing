import { z } from 'zod';

import { proposePredictedScore } from '../../ai/ops/predicted-score.js';
import type { JsonObject } from '../../contracts/json.js';
import { loadScoreContext, storePredictedScore } from '../../modules/stats/score.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../types.js';

const inputSchema = z.object({ student_id: z.uuid() });

export const predictedScore: JobHandler = async (ctx) => {
  const parsed = inputSchema.safeParse(ctx.job.input);
  if (!parsed.success) {
    throw new PermanentJobError('во входе операции нет идентификатора ученика', 'BAD_INPUT');
  }

  const studentId = parsed.data.student_id;
  const context = await loadScoreContext(ctx.sql, studentId);

  if (context === null) {
    throw new PermanentJobError('ученик не прошёл первичный опрос', 'NO_PROFILE');
  }

  const caller = await ctx.model();

  let value = context.baselineValue;
  let source: 'ai' | 'baseline' = 'baseline';
  let confidence = context.confidence;
  let rationale: string | null = null;
  let breakdown: JsonObject = { sections: [] };
  let clamped = false;

  if (caller !== null) {
    const proposal = await proposePredictedScore(caller, {
      scale: context.scale,
      examTitle: context.examTitle,
      maxScore: context.maxScore,
      baselineValue: context.baselineValue,
      sections: context.sections,
      history: context.history,
      daysLeft: context.daysLeft,
    });

    await ctx.logCalls(proposal.calls);

    if (proposal.value === null) {
      if (proposal.failure === 'unavailable' && ctx.retryOnModelOutage()) {
        throw new TransientJobError(`провайдер недоступен: ${proposal.reason ?? ''}`);
      }
      ctx.log.warn(
        { job_id: ctx.job.id, failure: proposal.failure, reason: proposal.reason },
        'прогноз моделью не получен, применяется расчёт',
      );
    } else {
      value = proposal.value;
      source = 'ai';
      confidence = Math.min(context.confidence, proposal.confidence ?? context.confidence);
      rationale = proposal.rationale;
      clamped = proposal.clamped;
      breakdown = {
        sections: proposal.breakdown.map((item) => ({
          subject_id: item.subjectId,
          expected_points: item.expectedPoints,
          max_points: item.maxPoints,
          note: item.note,
        })),
      };

      if (clamped) {
        ctx.log.info(
          { job_id: ctx.job.id },
          'прогноз модели прижат к коридору расчёта',
        );
      }
    }
  }

  if (source === 'baseline') {
    breakdown = {
      sections: context.sections
        .filter((section) => section.subjectId !== null)
        .map((section) => ({
          subject_id: section.subjectId,
          expected_points: section.points,
          max_points: section.maxPoints,
          note: '',
        })),
    };
  }

  return ctx.applyOnce(async (tx) => {
    const stored = await storePredictedScore(tx, studentId, {
      context,
      value,
      source,
      confidence,
      breakdown,
      aiJobId: source === 'ai' ? ctx.job.id : null,
    });

    return {
      source: source === 'ai' ? 'ai' : 'fallback',
      scale: stored.scale,
      value: stored.value,
      baseline_value: stored.baselineValue,
      max_score: stored.maxScore,
      confidence: stored.confidence,
      clamped,
      rationale,
      summary_md: rationale,
    };
  });
};
