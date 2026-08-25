import type { SqlExecutor } from '../../db/sql.js';
import { FAILED_ATTEMPTS_BEFORE_REPLAN, replanBucket } from '../../domain/roadmap.js';
import { enqueueJob } from '../../queue/jobs.js';
import { refreshLessonProgress } from '../lessons/service.js';

export function replanKey(studentId: string, subjectId: string, now = new Date()): string {
  return `roadmap_plan:${studentId}:${subjectId}:${replanBucket(now)}`;
}

export async function enqueueReplan(
  sql: SqlExecutor,
  studentId: string,
  subjectId: string,
  reason: string,
): Promise<void> {
  await enqueueJob(sql, {
    opType: 'roadmap_plan',
    requestedBy: studentId,
    studentId,
    dedupeKey: replanKey(studentId, subjectId),
    input: { student_id: studentId, subject_id: subjectId, reason },
  });
}

export async function planRoadmapsAfterDiagnostic(
  sql: SqlExecutor,
  studentId: string,
): Promise<number> {
  const subjects = await sql<{ subject_id: string }[]>`
    select ss.subject_id
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
     where ss.student_id = ${studentId} and ss.removed_at is null and s.is_active
     order by s.sort_order, s.code
  `;

  for (const { subject_id: subjectId } of subjects) {
    await enqueueReplan(sql, studentId, subjectId, 'разбор диагностики');
  }

  return subjects.length;
}

interface CheckedLesson {
  readonly lessonId: string;
  readonly subjectId: string;
  readonly topicId: string;
}

async function lessonOfAttempt(
  sql: SqlExecutor,
  attemptId: string,
): Promise<CheckedLesson | null> {
  const [row] = await sql<{ lesson_id: string; subject_id: string; topic_id: string }[]>`
    select l.id as lesson_id, l.subject_id, l.topic_id
      from public.attempts att
      join public.assessments a on a.id = att.assessment_id
      join public.lessons l on l.id = a.lesson_id
     where att.id = ${attemptId} and a.kind = 'knowledge_check'
     limit 1
  `;

  return row === undefined
    ? null
    : { lessonId: row.lesson_id, subjectId: row.subject_id, topicId: row.topic_id };
}

export interface CheckOutcome {
  readonly lessonId: string;
  readonly bestCheckPct: number;
  readonly progressPct: number;
  readonly completed: boolean;
}

export async function applyKnowledgeCheckResult(
  sql: SqlExecutor,
  attempt: { readonly id: string; readonly studentId: string; readonly scorePct: number | null },
): Promise<CheckOutcome | null> {
  const lesson = await lessonOfAttempt(sql, attempt.id);
  if (lesson === null) {
    return null;
  }

  const scorePct = attempt.scorePct ?? 0;

  await sql`
    insert into public.lesson_progress (student_id, lesson_id, best_check_pct, check_attempt_id)
    values (${attempt.studentId}, ${lesson.lessonId}, ${scorePct}, ${attempt.id})
    on conflict (student_id, lesson_id) do update
      set best_check_pct = greatest(
            coalesce(public.lesson_progress.best_check_pct, 0),
            excluded.best_check_pct
          ),
          check_attempt_id = case
            when coalesce(public.lesson_progress.best_check_pct, -1) < excluded.best_check_pct
              then excluded.check_attempt_id
            else public.lesson_progress.check_attempt_id
          end
  `;

  const progress = await refreshLessonProgress(sql, attempt.studentId, lesson.lessonId);

  const [stored] = await sql<{ best_check_pct: string | null }[]>`
    select best_check_pct from public.lesson_progress
     where student_id = ${attempt.studentId} and lesson_id = ${lesson.lessonId}
  `;

  await replanOnRepeatedFailure(sql, attempt.studentId, lesson);

  return {
    lessonId: lesson.lessonId,
    bestCheckPct: Number(stored?.best_check_pct ?? scorePct),
    progressPct: progress.progressPct,
    completed: progress.completed,
  };
}

async function replanOnRepeatedFailure(
  sql: SqlExecutor,
  studentId: string,
  lesson: CheckedLesson,
): Promise<void> {
  const rows = await sql<{ score_pct: string | null }[]>`
    select att.score_pct
      from public.attempts att
      join public.assessments a on a.id = att.assessment_id
     where att.student_id = ${studentId}
       and a.lesson_id = ${lesson.lessonId}
       and att.status = 'graded'
     order by att.graded_at desc nulls last, att.id desc
     limit ${FAILED_ATTEMPTS_BEFORE_REPLAN}
  `;

  if (rows.length < FAILED_ATTEMPTS_BEFORE_REPLAN) {
    return;
  }

  const allFailed = rows.every((row) => Number(row.score_pct ?? 0) < 50);
  if (!allFailed) {
    return;
  }

  await enqueueReplan(
    sql,
    studentId,
    lesson.subjectId,
    `три неудачные попытки подряд по теме ${lesson.topicId}`,
  );
}
