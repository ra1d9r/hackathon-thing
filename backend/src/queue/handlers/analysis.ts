import {
  mergeProposals,
  proposeMasteryChanges,
  type AnalysisScope,
  type AnalysisTopicInput,
  type TopicHighlight,
} from '../../ai/ops/analysis.js';
import { roundTo } from '../../contracts/domain.js';
import type { JsonObject } from '../../contracts/json.js';
import type { SqlExecutor } from '../../db/sql.js';
import {
  capDailyGrowth,
  computeTopicDeltas,
  pickHighlights,
  type TopicDelta,
  type TopicOutcome,
} from '../../domain/mastery.js';
import {
  findAttempt,
  loadAttemptAnswers,
  loadAttemptQuestions,
  type AttemptQuestion,
  type AttemptRow,
  type StoredAnswer,
} from '../../modules/attempts/queries.js';
import { completeItemForAttempt } from '../../modules/daily/streak.js';
import {
  applyKnowledgeCheckResult,
  planRoadmapsAfterDiagnostic,
} from '../../modules/roadmap/triggers.js';
import {
  PermanentJobError,
  TransientJobError,
  type JobContext,
  type JobHandler,
} from '../types.js';
import { loadStudentCurriculum } from '../../modules/curriculum/scope.js';
import { dedupeKey, enqueueJob } from '../jobs.js';
import { requireAttemptId } from './attempt-input.js';

interface TopicTotals {
  subjectId: string;
  title: string;
  earned: number;
  possible: number;
  graded: number;
  
  trust: number;
}

function collectTopics(
  questions: readonly AttemptQuestion[],
  answers: readonly StoredAnswer[],
): Map<string, TopicTotals> {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const totals = new Map<string, TopicTotals>();

  for (const question of questions) {
    const given = byQuestion.get(question.id);

    
    
    if (given?.grader === 'pending') {
      continue;
    }

    const entry = totals.get(question.topicId) ?? {
      subjectId: question.subjectId,
      title: question.topicTitle,
      earned: 0,
      possible: 0,
      graded: 0,
      trust: 1,
    };

    entry.earned += given?.pointsAwarded ?? 0;
    entry.possible += question.points;
    entry.graded += 1;

    
    
    if (given?.grader === 'ai' && given.aiConfidence !== null) {
      entry.trust = Math.min(entry.trust, given.aiConfidence);
    }

    totals.set(question.topicId, entry);
  }

  return totals;
}

async function loadCurrentMastery(
  sql: SqlExecutor,
  studentId: string,
  topicIds: readonly string[],
): Promise<Map<string, number>> {
  if (topicIds.length === 0) {
    return new Map();
  }

  
  
  const rows = await sql<{ topic_id: string; mastery_pct: string }[]>`
    select topic_id, mastery_pct
      from public.student_topic_mastery
     where student_id = ${studentId}
       and topic_id = any(${[...topicIds]}::uuid[])
  `;

  return new Map(rows.map((row) => [row.topic_id, Number(row.mastery_pct)]));
}

async function gainedToday(sql: SqlExecutor, studentId: string): Promise<number> {
  const [row] = await sql<{ gained: string | null }[]>`
    select sum(delta_pct) as gained
      from public.stat_events
     where student_id = ${studentId}
       and delta_pct > 0
       and created_at >= date_trunc('day', now())
  `;

  return row?.gained == null ? 0 : Number(row.gained);
}

function summaryFor(
  attempt: AttemptRow,
  deltas: readonly TopicDelta[],
  titles: ReadonlyMap<string, string>,
  pending: number,
): string {
  const { strengths, focus } = pickHighlights(deltas);
  const name = (delta: TopicDelta): string => titles.get(delta.topicId) ?? 'тема';

  const parts: string[] = [
    attempt.kind === 'diagnostic'
      ? `Диагностика пройдена: проверено тем — ${deltas.length}.`
      : `Попытка разобрана: проверено тем — ${deltas.length}.`,
  ];

  if (strengths.length > 0) {
    parts.push(`Сильные стороны: ${strengths.map(name).join(', ')}.`);
  }
  if (focus.length > 0) {
    parts.push(`Требуют внимания: ${focus.map(name).join(', ')}.`);
  }
  if (pending > 0) {
    parts.push(`Свободных ответов на проверке: ${pending}.`);
  }

  return parts.join(' ');
}

function sourceTypeFor(kind: string): 'attempt' | 'mock_attempt' {
  return kind === 'exam_mock' ? 'mock_attempt' : 'attempt';
}

async function writeStatEvents(
  tx: SqlExecutor,
  attempt: AttemptRow,
  deltas: readonly TopicDelta[],
): Promise<void> {
  if (deltas.length === 0) {
    return;
  }

  const sourceType = sourceTypeFor(attempt.kind);

  
  
  
  await tx`
    insert into public.stat_events (
      student_id, topic_id, subject_id, source_type, source_id,
      delta_pct, baseline_pct, observed_pct, evidence_weight, reason
    )
    select ${attempt.studentId}, item.topic_id::uuid, item.subject_id::uuid,
           ${sourceType}::public.stat_source_type, ${attempt.id},
           item.delta_pct::numeric, item.baseline_pct::numeric,
           item.observed_pct::numeric, item.evidence_weight::numeric,
           ${`Результат попытки (${attempt.kind})`}
      -- Значения передаются текстом и приводятся здесь: массив параметров
      -- одного типа надёжнее, чем полагаться на вывод типов драйвером.
      from unnest(
             ${deltas.map((delta) => delta.topicId)}::text[],
             ${deltas.map((delta) => delta.subjectId)}::text[],
             ${deltas.map((delta) => String(delta.deltaPct))}::text[],
             ${deltas.map((delta) => (delta.baselinePct === null ? null : String(delta.baselinePct)))}::text[],
             ${deltas.map((delta) => String(delta.observedPct))}::text[],
             ${deltas.map((delta) => String(delta.evidenceWeight))}::text[]
           ) as item(topic_id, subject_id, delta_pct, baseline_pct, observed_pct, evidence_weight)
    -- Индекс частичный, поэтому предикат приходится повторить.
    -- Повторное начисление по одному источнику невозможно физически.
    on conflict (student_id, source_type, source_id, topic_id) where source_id is not null
    do nothing
  `;
}

async function analysisScope(
  sql: SqlExecutor,
  studentId: string,
): Promise<AnalysisScope | null> {
  try {
    const curriculum = await loadStudentCurriculum(sql, studentId);
    const names = await sql<{ name_ru: string }[]>`
      select name_ru from public.subjects
       where id = any(${[...curriculum.subjectIds]}::uuid[])
       order by sort_order, code
    `;

    return {
      gradeMin: curriculum.scope.gradeMin,
      gradeMax: curriculum.scope.gradeMax,
      reason: curriculum.scope.reason,
      subjectNames: names.map((row) => row.name_ru),
    };
  } catch {
    return null;
  }
}

async function snapshotMastery(
  tx: SqlExecutor,
  studentId: string,
  reason: string,
): Promise<void> {
  const rows = await tx<
    { topic_id: string; subject_id: string; mastery_pct: string; confidence: string }[]
  >`
    select topic_id, subject_id, mastery_pct, confidence
      from public.student_topic_mastery
     where student_id = ${studentId}
  `;

  const payload = {
    topics: rows.map((row) => ({
      topic_id: row.topic_id,
      subject_id: row.subject_id,
      mastery_pct: Number(row.mastery_pct),
      confidence: Number(row.confidence),
    })),
  };

  await tx`
    insert into public.mastery_snapshots (student_id, reason, payload)
    values (${studentId}, ${reason}, ${tx.json(payload)})
  `;
}

async function run(ctx: JobContext): Promise<JsonObject> {
  const attemptId = requireAttemptId(ctx.job.input);
  const attempt = await findAttempt(ctx.sql, attemptId);

  if (attempt === null) {
    throw new PermanentJobError('попытка удалена', 'ATTEMPT_GONE');
  }
  if (attempt.status === 'abandoned') {
    throw new PermanentJobError('попытка брошена', 'ATTEMPT_ABANDONED');
  }

  const [questions, answers] = await Promise.all([
    loadAttemptQuestions(ctx.sql, attempt.assessmentId),
    loadAttemptAnswers(ctx.sql, attempt.id),
  ]);

  const totals = collectTopics(questions, answers);
  const topicIds = [...totals.keys()];
  const currentMastery = await loadCurrentMastery(ctx.sql, attempt.studentId, topicIds);

  const outcomes: TopicOutcome[] = [...totals].map(([topicId, entry]) => ({
    topicId,
    subjectId: entry.subjectId,
    pointsEarned: entry.earned,
    pointsPossible: entry.possible,
    questionsGraded: entry.graded,
    trust: entry.trust,
  }));

  const isDiagnostic = attempt.kind === 'diagnostic';

  
  
  const deterministic = computeTopicDeltas(outcomes, {
    currentMastery,
    baselineFromObserved: isDiagnostic,
  });

  const titles = new Map([...totals].map(([topicId, entry]) => [topicId, entry.title]));
  const pending = answers.filter((answer) => answer.grader === 'pending').length;

  
  
  const caller = await ctx.model();
  let summaryFromModel: string | null = null;
  let strengthsFromModel: readonly TopicHighlight[] = [];
  let weaknessesFromModel: readonly TopicHighlight[] = [];
  let clampedCount = 0;
  let modelUsed = false;

  let deltas = deterministic;

  if (caller !== null && deterministic.length > 0) {
    const inputs: AnalysisTopicInput[] = deterministic.map((delta) => {
      const entry = totals.get(delta.topicId);
      return {
        topicId: delta.topicId,
        subjectId: delta.subjectId,
        title: entry?.title ?? '',
        pointsEarned: roundTo(entry?.earned ?? 0, 2),
        pointsPossible: roundTo(entry?.possible ?? 0, 2),
        observedPct: delta.observedPct,
        currentMasteryPct: currentMastery.get(delta.topicId) ?? null,
        deterministicDeltaPct: delta.deltaPct,
      };
    });

    
    
    const scope = await analysisScope(ctx.sql, attempt.studentId);

    const proposal = await proposeMasteryChanges(ctx.sql, caller, inputs, {
      isDiagnostic,
      opType: ctx.job.opType,
      scope,
    });
    await ctx.logCalls(proposal.calls);

    if (proposal.proposals === null) {
      
      
      
      if (proposal.failure === 'unavailable' && ctx.retryOnModelOutage()) {
        throw new TransientJobError(`провайдер недоступен: ${proposal.reason ?? ''}`);
      }

      ctx.log.warn(
        { job_id: ctx.job.id, failure: proposal.failure, reason: proposal.reason },
        'разбор моделью не выполнен, применяется расчёт',
      );
    } else {
      deltas = mergeProposals(deterministic, proposal.proposals);
      summaryFromModel = proposal.summaryMd;
      strengthsFromModel = proposal.strengths;
      weaknessesFromModel = proposal.weaknesses;
      clampedCount = proposal.clampedCount;
      modelUsed = true;

      if (clampedCount > 0) {
        
        
        ctx.log.info(
          { job_id: ctx.job.id, clamped: clampedCount },
          'предложения модели прижаты к коридору расчёта',
        );
      }
    }
  }

  
  
  deltas = capDailyGrowth(deltas, await gainedToday(ctx.sql, attempt.studentId));

  return ctx.applyOnce(async (tx) => {
    await writeStatEvents(tx, attempt, deltas);

    
    
    
    await tx`
      update public.attempts
         set status = 'graded', graded_at = now()
       where id = ${attempt.id} and status in ('submitted','grading')
    `;

    
    
    
    
    
    
    
    await enqueueJob(tx, {
      opType: 'predicted_score',
      requestedBy: attempt.studentId,
      studentId: attempt.studentId,
      dedupeKey: dedupeKey.predictedScore(attempt.studentId),
      input: { student_id: attempt.studentId },
    });

    if (isDiagnostic) {
      await snapshotMastery(tx, attempt.studentId, 'diagnostic');
      await tx`
        update public.student_profiles
           set diagnostic_attempt_id = ${attempt.id},
               passed_diagnostics = true
         where student_id = ${attempt.studentId}
      `;

      
      
      await planRoadmapsAfterDiagnostic(tx, attempt.studentId);
    } else if (attempt.kind === 'exam_mock') {
      await snapshotMastery(tx, attempt.studentId, 'mock');
    } else if (attempt.kind === 'knowledge_check') {
      
      
      
      await applyKnowledgeCheckResult(tx, {
        id: attempt.id,
        studentId: attempt.studentId,
        scorePct: attempt.scorePct,
      });
    }

    
    
    
    await completeItemForAttempt(tx, attempt.studentId, attempt.id);

    
    
    const masteryByTopic = await loadCurrentMastery(tx, attempt.studentId, topicIds);
    const computed = pickHighlights(deltas);
    const observed = new Map(deltas.map((delta) => [delta.topicId, delta.observedPct]));

    
    const highlight = (
      fromModel: readonly TopicHighlight[],
      fallback: readonly { topicId: string; observedPct: number }[],
    ): { topic_id: string; title: string; pct: number; note: string | null }[] =>
      fromModel.length > 0
        ? fromModel.map((item) => ({
            topic_id: item.topicId,
            title: titles.get(item.topicId) ?? '',
            pct: observed.get(item.topicId) ?? 0,
            note: item.note,
          }))
        : fallback.map((item) => ({
            topic_id: item.topicId,
            title: titles.get(item.topicId) ?? '',
            pct: item.observedPct,
            note: null,
          }));

    return {
      source: modelUsed ? 'ai' : 'fallback',
      summary_md: summaryFromModel ?? summaryFor(attempt, deltas, titles, pending),
      clamped_count: clampedCount,
      pending_questions: pending,
      topics: deltas.map((delta) => ({
        topic_id: delta.topicId,
        observed_pct: delta.observedPct,
        delta_pct: delta.deltaPct,
        mastery_pct: masteryByTopic.get(delta.topicId) ?? null,
        evidence_weight: delta.evidenceWeight,
      })),
      strengths: highlight(strengthsFromModel, computed.strengths),
      focus: highlight(weaknessesFromModel, computed.focus),
      score_pct:
        attempt.maxScore === null || attempt.maxScore === 0 || attempt.rawScore === null
          ? null
          : roundTo((attempt.rawScore / attempt.maxScore) * 100, 2),
    };
  });
}

export const attemptAnalysis: JobHandler = run;
