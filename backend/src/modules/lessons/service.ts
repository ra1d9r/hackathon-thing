import type { z } from 'zod';

import {
  materialViewKindSchema,
  roadmapNodeStatusSchema,
  type knowledgeCheckResponseSchema,
  type lessonLibraryResponseSchema,
  type lessonResponseSchema,
  type materialReadResponseSchema,
} from '../../contracts/dto/roadmap.js';
import { AppError } from '../../contracts/errors.js';
import { sanitizeMarkdown } from '../../contracts/markdown.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import { nodeProgress, nodeStatus } from '../../domain/roadmap.js';
import { enqueueJob, pollUrl, SUGGESTED_WAIT_MS } from '../../queue/jobs.js';
import type { AuthUser } from '../../types/fastify.js';
import { loadStudentCurriculum } from '../curriculum/scope.js';
import { completeLessonItems } from '../daily/streak.js';
import { parseOutline, syncRoadmapStates } from '../roadmap/queries.js';

export type LessonResponse = z.infer<typeof lessonResponseSchema>;
export type MaterialReadResponse = z.infer<typeof materialReadResponseSchema>;
export type KnowledgeCheckResponse = z.infer<typeof knowledgeCheckResponseSchema>;
export type LessonLibraryResponse = z.infer<typeof lessonLibraryResponseSchema>;

interface LessonRow {
  id: string;
  title: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  topic_id: string;
  topic_title: string;
  outline: unknown;
  material_id: string | null;
  material_title: string | null;
  material_summary: string | null;
  material_view_kind: string | null;
  material_body_md: string | null;
  material_hash: string | null;
  material_bundle_key: string | null;
  material_bundle_hash: string | null;
  material_external_url: string | null;
  material_minutes: number | null;
  grade_min: number | null;
  grade_max: number | null;
}

async function loadLesson(sql: SqlExecutor, lessonId: string): Promise<LessonRow> {
  const [row] = await sql<LessonRow[]>`
    select l.id, l.title, l.subject_id, s.code as subject_code, s.name_ru as subject_name,
           l.topic_id, t.title_ru as topic_title, l.outline,
           l.grade_min, l.grade_max,
           m.id as material_id, m.title as material_title, m.summary as material_summary,
           m.student_view_kind::text as material_view_kind, m.body_md as material_body_md,
           m.content_hash as material_hash, m.bundle_key as material_bundle_key,
           m.bundle_hash as material_bundle_hash, m.external_url as material_external_url,
           m.est_read_minutes as material_minutes
      from public.lessons l
      join public.subjects s on s.id = l.subject_id
      join public.topics t on t.id = l.topic_id
      left join public.materials m on m.id = l.material_id and m.status = 'published'
     where l.id = ${lessonId} and l.is_active
     limit 1
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND');
  }

  return row;
}

async function assertInScope(sql: SqlExecutor, studentId: string, lesson: LessonRow): Promise<void> {
  const [allowed] = await sql<{ ok: boolean }[]>`
    select true as ok
      from public.student_subjects ss
     where ss.student_id = ${studentId}
       and ss.subject_id = ${lesson.subject_id}
       and ss.removed_at is null
     limit 1
  `;

  if (allowed === undefined) {
    throw new AppError('NOT_FOUND');
  }
}

interface ProgressRow {
  progress_pct: string;
  material_read_at: Date | null;
  best_check_pct: string | null;
  completed_at: Date | null;
}

async function loadProgress(
  sql: SqlExecutor,
  studentId: string,
  lessonId: string,
): Promise<LessonResponse['progress']> {
  const [row] = await sql<ProgressRow[]>`
    select progress_pct, material_read_at, best_check_pct, completed_at
      from public.lesson_progress
     where student_id = ${studentId} and lesson_id = ${lessonId}
  `;

  if (row === undefined) {
    return {
      progress_pct: 0,
      material_read: false,
      material_read_at: null,
      best_check_pct: null,
      completed_at: null,
    };
  }

  return {
    progress_pct: Number(row.progress_pct),
    material_read: row.material_read_at !== null,
    material_read_at: row.material_read_at?.toISOString() ?? null,
    best_check_pct: row.best_check_pct === null ? null : Number(row.best_check_pct),
    completed_at: row.completed_at?.toISOString() ?? null,
  };
}

function toMaterialView(row: LessonRow): LessonResponse['material'] {
  if (row.material_id === null || row.material_hash === null) {
    return null;
  }

  const parsed = row.material_body_md === null ? null : sanitizeMarkdown(row.material_body_md);
  const viewKind = materialViewKindSchema.catch('markdown').parse(row.material_view_kind);

  return {
    id: row.material_id,
    title: row.material_title ?? '',
    summary: row.material_summary,
    view_kind: viewKind,
    content_hash: row.material_hash,
    body_md: parsed?.bodyMd ?? null,
    body_blocks: parsed?.blocks ?? [],
    bundle:
      row.material_bundle_key === null || row.material_bundle_hash === null
        ? null
        : { key: row.material_bundle_key, hash: row.material_bundle_hash },
    external_url: row.material_external_url,
    est_read_minutes: row.material_minutes,
  };
}

export async function getLesson(
  sql: Sql,
  user: AuthUser,
  lessonId: string,
): Promise<LessonResponse> {
  const lesson = await loadLesson(sql, lessonId);
  await assertInScope(sql, user.id, lesson);

  const material = toMaterialView(lesson);

  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      subject: {
        id: lesson.subject_id,
        code: lesson.subject_code,
        name: lesson.subject_name,
      },
      topic: { id: lesson.topic_id, title: lesson.topic_title },
      outline: parseOutline(lesson.outline),
    },
    material,
    progress: await loadProgress(sql, user.id, lessonId),
    offline: {
      material_available:
        material !== null && (material.view_kind === 'bundled' || material.view_kind === 'markdown'),
      knowledge_check_requires_network: true,
    },
  };
}

interface LibraryRow {
  lesson_id: string;
  lesson_title: string;
  topic_id: string;
  topic_title: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  subject_sort: number;
  topic_sort: number;
  has_material: boolean;
  est_read_minutes: number | null;
  progress_pct: string | null;
  material_read_at: Date | null;
  best_check_pct: string | null;
  completed_at: Date | null;
}

export async function listLessons(sql: Sql, user: AuthUser): Promise<LessonLibraryResponse> {
  const curriculum = await loadStudentCurriculum(sql, user.id);

  if (curriculum.subjectIds.length === 0) {
    return { subjects: [], empty_reason: 'no_subjects' };
  }

  const rows = await sql<LibraryRow[]>`
    select distinct on (t.id)
           l.id as lesson_id, l.title as lesson_title,
           t.id as topic_id, t.title_ru as topic_title,
           s.id as subject_id, s.code as subject_code, s.name_ru as subject_name,
           s.sort_order as subject_sort, t.sort_order as topic_sort,
           (m.id is not null) as has_material,
           m.est_read_minutes,
           lp.progress_pct, lp.material_read_at, lp.best_check_pct, lp.completed_at
      from public.lessons l
      join public.topics t on t.id = l.topic_id
      join public.subjects s on s.id = l.subject_id
      join public.student_subjects ss
            on ss.subject_id = s.id and ss.student_id = ${user.id} and ss.removed_at is null
      left join public.materials m on m.id = l.material_id and m.status = 'published'
      left join public.lesson_progress lp
             on lp.lesson_id = l.id and lp.student_id = ${user.id}
     where l.is_active and t.is_active and s.is_active
       and t.grade_min <= ${curriculum.scope.gradeMax}::int
       and t.grade_max >= ${curriculum.scope.gradeMin}::int
     -- distinct on требует, чтобы порядок начинался с той же темы; всё
     -- остальное — правило выбора урока внутри неё.
     order by t.id, (l.origin = 'curated') desc, l.created_at, l.id
  `;

  if (rows.length === 0) {
    return { subjects: [], empty_reason: 'no_lessons' };
  }

  const ordered = [...rows].sort(
    (left, right) =>
      left.subject_sort - right.subject_sort ||
      left.subject_code.localeCompare(right.subject_code) ||
      left.topic_sort - right.topic_sort ||
      left.topic_title.localeCompare(right.topic_title),
  );

  const bySubject = new Map<string, LessonLibraryResponse['subjects'][number]>();

  for (const row of ordered) {
    const subject = bySubject.get(row.subject_id) ?? {
      id: row.subject_id,
      code: row.subject_code,
      name: row.subject_name,
      lessons: [],
    };

    subject.lessons.push({
      id: row.lesson_id,
      title: row.lesson_title,
      topic: { id: row.topic_id, title: row.topic_title },
      est_read_minutes: row.est_read_minutes,
      has_material: row.has_material,
      progress_pct: Number(row.progress_pct ?? 0),
      material_read: row.material_read_at !== null,
      best_check_pct: row.best_check_pct === null ? null : Number(row.best_check_pct),
      completed: row.completed_at !== null,
    });

    bySubject.set(row.subject_id, subject);
  }

  return { subjects: [...bySubject.values()], empty_reason: null };
}

export async function refreshLessonProgress(
  sql: SqlExecutor,
  studentId: string,
  lessonId: string,
): Promise<{ progressPct: number; completed: boolean }> {
  const [row] = await sql<
    { material_read_at: string | null; best_check_pct: string | null }[]
  >`
    select material_read_at, best_check_pct
      from public.lesson_progress
     where student_id = ${studentId} and lesson_id = ${lessonId}
  `;

  const progress = nodeProgress({
    materialRead: row?.material_read_at != null,
    bestCheckPct: row?.best_check_pct == null ? null : Number(row.best_check_pct),
  });

  await sql`
    update public.lesson_progress
       set progress_pct = ${progress.progressPct},
           completed_at = case
             when ${progress.completed} then coalesce(completed_at, now())
             else null
           end
     where student_id = ${studentId} and lesson_id = ${lessonId}
  `;

  await syncNodesForLesson(sql, studentId, lessonId);

  if (progress.completed) {
    await completeLessonItems(sql, studentId, lessonId);
  }

  return progress;
}

async function syncNodesForLesson(
  sql: SqlExecutor,
  studentId: string,
  lessonId: string,
): Promise<void> {
  const roadmaps = await sql<{ roadmap_id: string }[]>`
    select distinct n.roadmap_id
      from public.roadmap_nodes n
      join public.roadmaps r on r.id = n.roadmap_id
     where n.lesson_id = ${lessonId} and r.student_id = ${studentId} and r.is_active
  `;

  for (const { roadmap_id: roadmapId } of roadmaps) {
    await syncRoadmapStates(sql, studentId, roadmapId);
  }
}

export async function markMaterialRead(
  sql: Sql,
  user: AuthUser,
  lessonId: string,
): Promise<MaterialReadResponse> {
  const lesson = await loadLesson(sql, lessonId);
  await assertInScope(sql, user.id, lesson);

  await sql.begin(async (tx) => {
    await tx`
      insert into public.lesson_progress (student_id, lesson_id, material_read_at)
      values (${user.id}, ${lessonId}, now())
      on conflict (student_id, lesson_id) do update
        set material_read_at = coalesce(public.lesson_progress.material_read_at, now())
    `;

    await refreshLessonProgress(tx, user.id, lessonId);
  });

  const progress = await loadProgress(sql, user.id, lessonId);

  const [node] = await sql<
    { id: string; status: string; progress_pct: string }[]
  >`
    select n.id, n.status::text as status, n.progress_pct
      from public.roadmap_nodes n
      join public.roadmaps r on r.id = n.roadmap_id
     where n.lesson_id = ${lessonId} and r.student_id = ${user.id} and r.is_active
     -- Урок может встретиться в картах двух предметов. Порядок задан явно:
     -- без него ответ на один и тот же запрос менялся бы от раза к разу.
     order by r.subject_id, n.position
     limit 1
  `;

  return {
    progress,
    node:
      node === undefined
        ? null
        : {
            id: node.id,
            status: roadmapNodeStatusSchema.catch('locked').parse(node.status),
            progress_pct: Number(node.progress_pct),
          },
  };
}

export async function openKnowledgeCheck(
  sql: Sql,
  user: AuthUser,
  lessonId: string,
): Promise<KnowledgeCheckResponse> {
  const lesson = await loadLesson(sql, lessonId);
  await assertInScope(sql, user.id, lesson);

  const existing = await loadActiveCheck(sql, user.id, lessonId);
  if (existing !== null) {
    return { assessment: existing, job: null };
  }

  if (lesson.material_id === null) {
    throw new AppError('STATE_CONFLICT', {
      message: 'У урока нет материала, по которому можно составить проверку',
    });
  }

  const job = await enqueueJob(sql, {
    opType: 'knowledge_check_generation',
    requestedBy: user.id,
    studentId: user.id,
    dedupeKey: `knowledge_check_generation:${user.id}:${lessonId}`,
    input: { student_id: user.id, lesson_id: lessonId },
  });

  return {
    assessment: null,
    job: {
      job_id: job.id,
      status: job.status,
      poll_url: pollUrl(job.id),
      suggested_wait_ms: SUGGESTED_WAIT_MS.knowledge_check_generation,
    },
  };
}

export async function loadActiveCheck(
  sql: SqlExecutor,
  studentId: string,
  lessonId: string,
): Promise<KnowledgeCheckResponse['assessment']> {
  const [row] = await sql<
    {
      id: string;
      title: string;
      outline: unknown;
      total_points: string;
      source_job_id: string | null;
      question_count: string;
    }[]
  >`
    select a.id, a.title, a.outline, a.total_points, a.source_job_id,
           (select count(*) from public.assessment_questions aq where aq.assessment_id = a.id)
             as question_count
      from public.assessments a
     where a.kind = 'knowledge_check'
       and a.student_id = ${studentId}
       and a.lesson_id = ${lessonId}
       and a.is_active
     order by a.created_at desc
     limit 1
  `;

  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    question_count: Number(row.question_count),
    total_points: Number(row.total_points),
    outline: parseOutline(row.outline),
    source: row.source_job_id === null ? 'bank' : 'ai',
  };
}

export function statusForProgress(
  materialRead: boolean,
  bestCheckPct: number | null,
  prerequisitesMet: boolean,
): string {
  return nodeStatus({ materialRead, bestCheckPct, prerequisitesMet });
}
