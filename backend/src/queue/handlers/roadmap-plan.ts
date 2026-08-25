import { z } from 'zod';

import {
  proposeRoadmap,
  type PlannableTopicContext,
  type PlannedNode,
} from '../../ai/ops/roadmap-plan.js';
import type { JsonObject } from '../../contracts/json.js';
import { buildRoadmap } from '../../modules/roadmap/build.js';
import { loadPlannableTopics } from '../../modules/roadmap/queries.js';
import { loadStudentCurriculum } from '../../modules/curriculum/scope.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../types.js';

const inputSchema = z.object({
  student_id: z.uuid(),
  subject_id: z.uuid(),
  reason: z.string().max(300).nullable().default(null),
});

export const roadmapPlan: JobHandler = async (ctx) => {
  const parsed = inputSchema.safeParse(ctx.job.input);
  if (!parsed.success) {
    throw new PermanentJobError('во входе операции нет ученика или предмета', 'BAD_INPUT');
  }

  const { student_id: studentId, subject_id: subjectId, reason } = parsed.data;

  const curriculum = await loadStudentCurriculum(ctx.sql, studentId);
  if (!curriculum.subjectIds.includes(subjectId)) {
    
    
    throw new PermanentJobError('предмет не выбран учеником', 'SUBJECT_NOT_SELECTED');
  }

  const topics = await loadPlannableTopics(
    ctx.sql,
    studentId,
    subjectId,
    curriculum.scope.gradeMin,
    curriculum.scope.gradeMax,
  );

  if (topics.length === 0) {
    throw new PermanentJobError('у предмета нет тем с материалом', 'NO_TOPICS');
  }

  const caller = await ctx.model();
  let proposal: readonly PlannedNode[] | null = null;
  let replanReason = reason;
  let rejected = 0;

  if (caller !== null) {
    const context: PlannableTopicContext[] = topics.map((topic) => ({
      topicId: topic.topicId,
      title: topic.title,
      gradeMin: topic.gradeMin,
      gradeMax: topic.gradeMax,
      masteryPct: topic.masteryPct,
      priority: topic.priority,
      prerequisiteIds: topic.prerequisiteIds,
      materialIds: topic.materialIds,
    }));

    const outcome = await proposeRoadmap(caller, {
      subjectName: curriculum.subjects.find((item) => item.id === subjectId)?.name ?? '',
      scope: curriculum.scope,
      goalTitle: curriculum.goal,
      topics: context,
      replanReason: reason,
    });

    await ctx.logCalls(outcome.calls);
    rejected = outcome.rejected;

    if (outcome.nodes === null) {
      if (outcome.failure === 'unavailable' && ctx.retryOnModelOutage()) {
        throw new TransientJobError(`провайдер недоступен: ${outcome.reason ?? ''}`);
      }
      ctx.log.warn(
        { job_id: ctx.job.id, failure: outcome.failure, reason: outcome.reason },
        'план моделью не получен, карта строится расчётом',
      );
    } else {
      proposal = outcome.nodes;
      replanReason = outcome.replanReason ?? reason;
    }

    if (rejected > 0) {
      
      
      
      ctx.log.info({ job_id: ctx.job.id, rejected }, 'узлы плана отброшены сверкой с каталогом');
    }
  }

  return ctx.applyOnce(async (tx) => {
    const built = await buildRoadmap(
      tx,
      {
        studentId,
        subjectId,
        aiJobId: proposal === null ? null : ctx.job.id,
        replanReason,
        proposal,
        topics,
      },
      curriculum.scope,
    );

    if (built === null) {
      throw new PermanentJobError('у предмета нет тем с материалом', 'NO_TOPICS');
    }

    const result: JsonObject = {
      source: built.source,
      roadmap_id: built.roadmapId,
      version: built.version,
      nodes: built.nodeCount,
      topics_available: built.topicsAvailable,
      rejected,
      replan_reason: replanReason,
    };

    return result;
  });
};
