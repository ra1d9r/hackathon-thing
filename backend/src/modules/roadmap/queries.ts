import type { SqlExecutor } from '../../db/sql.js';
import { unlockNodes } from '../../domain/roadmap.js';
import type { LessonOutlineStep } from '../../contracts/ai/roadmap.js';
import { lessonOutlineStepSchema } from '../../contracts/ai/roadmap.js';

export interface PlannableRow {
  readonly topicId: string;
  readonly title: string;
  readonly gradeMin: number;
  readonly gradeMax: number;
  readonly masteryPct: number | null;
  readonly priority: number;
  readonly sortOrder: number;
  readonly prerequisiteIds: readonly string[];
  readonly materialIds: readonly string[];
  
  readonly defaultMaterialId: string | null;
  readonly defaultLessonId: string | null;
}

export async function loadPlannableTopics(
  sql: SqlExecutor,
  studentId: string,
  subjectId: string,
  gradeMin: number,
  gradeMax: number,
): Promise<PlannableRow[]> {
  const rows = await sql<
    {
      topic_id: string;
      title_ru: string;
      grade_min: number;
      grade_max: number;
      mastery_pct: string | null;
      priority: string | null;
      sort_order: number;
      prerequisite_ids: string[] | null;
      material_ids: string[] | null;
      default_material_id: string | null;
      default_lesson_id: string | null;
    }[]
  >`
    with scoped as (
      select t.id, t.title_ru, t.grade_min, t.grade_max, t.sort_order
        from public.topics t
       where t.is_active
         and t.subject_id = ${subjectId}
         and t.grade_min <= ${gradeMax}::int
         and t.grade_max >= ${gradeMin}::int
    ),
    usable as (
      select mt.topic_id, mt.material_id, m.est_read_minutes,
             row_number() over (
               partition by mt.topic_id
               order by mt.weight desc, m.updated_at desc, m.id
             ) as rank
        from public.material_topics mt
        join public.materials m on m.id = mt.material_id
       where m.status = 'published'
         and m.ai_text is not null
    )
    select s.id as topic_id, s.title_ru, s.grade_min, s.grade_max, s.sort_order,
           tm.mastery_pct, tm.priority,
           (
             select coalesce(array_agg(tp.prerequisite_id order by tp.prerequisite_id), '{}')
               from public.topic_prerequisites tp
              where tp.topic_id = s.id
           ) as prerequisite_ids,
           (
             select coalesce(array_agg(u.material_id order by u.rank), '{}')
               from usable u
              where u.topic_id = s.id
           ) as material_ids,
           (select u.material_id from usable u where u.topic_id = s.id and u.rank = 1)
             as default_material_id,
           (
             select l.id from public.lessons l
              where l.topic_id = s.id and l.is_active
              order by l.origin = 'curated' desc, l.created_at, l.id
              limit 1
           ) as default_lesson_id
      from scoped s
      left join public.student_topic_mastery tm
             on tm.topic_id = s.id and tm.student_id = ${studentId}
     where exists (select 1 from usable u where u.topic_id = s.id)
     order by s.sort_order, s.id
  `;

  return rows.map((row) => ({
    topicId: row.topic_id,
    title: row.title_ru,
    gradeMin: row.grade_min,
    gradeMax: row.grade_max,
    masteryPct: row.mastery_pct === null ? null : Number(row.mastery_pct),
    priority: Number(row.priority ?? 0),
    sortOrder: row.sort_order,
    prerequisiteIds: row.prerequisite_ids ?? [],
    materialIds: row.material_ids ?? [],
    defaultMaterialId: row.default_material_id,
    defaultLessonId: row.default_lesson_id,
  }));
}

export interface NodeToStore {
  readonly position: number;
  readonly topicId: string;
  readonly lessonId: string | null;
  readonly materialId: string | null;
  readonly title: string;
  readonly outline: readonly LessonOutlineStep[];
  readonly rationale: string | null;
}

export interface StoreRoadmapInput {
  readonly studentId: string;
  readonly subjectId: string;
  readonly nodes: readonly NodeToStore[];
  readonly aiJobId: string | null;
  readonly replanReason: string | null;
}

export interface StoredRoadmap {
  readonly roadmapId: string;
  readonly version: number;
  readonly nodeCount: number;
}

export async function storeRoadmap(
  sql: SqlExecutor,
  input: StoreRoadmapInput,
): Promise<StoredRoadmap> {
  await sql`
    update public.roadmaps
       set is_active = false
     where student_id = ${input.studentId}
       and subject_id = ${input.subjectId}
       and is_active
  `;

  
  
  
  
  
  
  
  
  const payload = input.nodes.map((node) => ({
    position: node.position,
    topic_id: node.topicId,
    lesson_id: node.lessonId,
    material_id: node.materialId,
    title: node.title,
    draft: [...node.outline],
    rationale: node.rationale,
  }));

  const [roadmap] = await sql<{ id: string; version: number }[]>`
    with edits as (
      -- По одной правке на тему, из самой свежей версии карты. Без
      -- distinct on правки нескольких версий размножились бы соединением,
      -- и в карте появились бы дубли позиций.
      select distinct on (n.topic_id) n.topic_id, n.outline, n.outline_edited_at
        from public.roadmap_nodes n
        join public.roadmaps r on r.id = n.roadmap_id
       where r.student_id = ${input.studentId}
         and r.subject_id = ${input.subjectId}
         and n.outline_edited_at is not null
       order by n.topic_id, r.version desc
    ),
    created as (
      insert into public.roadmaps (
        student_id, subject_id, version, is_active, ai_job_id, rationale
      ) values (
        ${input.studentId},
        ${input.subjectId},
        coalesce((
          select max(version) + 1 from public.roadmaps
           where student_id = ${input.studentId} and subject_id = ${input.subjectId}
        ), 1),
        true,
        ${input.aiJobId},
        ${input.replanReason}
      )
      returning id, version
    ),
    saved as (
      insert into public.roadmap_nodes (
        roadmap_id, position, topic_id, lesson_id, material_id, title,
        outline, outline_draft, outline_edited_at, rationale
      )
      select c.id, p.position, p.topic_id::uuid, p.lesson_id::uuid, p.material_id::uuid,
             p.title,
             -- Правка человека переживает перепланирование: черновик модели
             -- переписывается, действующий план — только если правок не было.
             coalesce(e.outline, p.draft), p.draft, e.outline_edited_at, p.rationale
        from created c
        cross join jsonb_to_recordset(${sql.json(payload)}) as p(
          position smallint, topic_id text, lesson_id text, material_id text,
          title text, draft jsonb, rationale text
        )
        left join edits e on e.topic_id = p.topic_id::uuid
      returning 1
    )
    select id, version from created
  `;

  if (roadmap === undefined) {
    throw new Error('не удалось создать дорожную карту');
  }

  return { roadmapId: roadmap.id, version: roadmap.version, nodeCount: input.nodes.length };
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export interface RoadmapNodeRow {
  readonly id: string;
  readonly position: number;
  readonly topicId: string;
  readonly topicTitle: string;
  readonly title: string;
  readonly lessonId: string | null;
  readonly materialId: string | null;
  readonly outline: LessonOutlineStep[];
  readonly outlineEdited: boolean;
  readonly rationale: string | null;
  readonly prerequisiteIds: readonly string[];
  readonly materialRead: boolean;
  readonly bestCheckPct: number | null;
  readonly completedAt: string | null;
}

export interface RoadmapHeader {
  readonly id: string;
  readonly subjectId: string;
  readonly subjectCode: string;
  readonly subjectName: string;
  readonly version: number;
  readonly generatedAt: string;
  readonly aiJobId: string | null;
  readonly replanReason: string | null;
}

export function parseOutline(raw: unknown): LessonOutlineStep[] {
  const parsed = lessonOutlineStepSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export async function loadActiveRoadmap(
  sql: SqlExecutor,
  studentId: string,
  subjectId: string,
): Promise<RoadmapHeader | null> {
  const [row] = await sql<
    {
      id: string;
      subject_id: string;
      code: string;
      name_ru: string;
      version: number;
      generated_at: Date;
      ai_job_id: string | null;
      rationale: string | null;
    }[]
  >`
    select r.id, r.subject_id, s.code, s.name_ru, r.version,
           r.generated_at, r.ai_job_id, r.rationale
      from public.roadmaps r
      join public.subjects s on s.id = r.subject_id
     where r.student_id = ${studentId} and r.subject_id = ${subjectId} and r.is_active
     limit 1
  `;

  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    subjectId: row.subject_id,
    subjectCode: row.code,
    subjectName: row.name_ru,
    version: row.version,
    generatedAt: row.generated_at.toISOString(),
    aiJobId: row.ai_job_id,
    replanReason: row.rationale,
  };
}

export async function loadRoadmapNodes(
  sql: SqlExecutor,
  studentId: string,
  roadmapId: string,
): Promise<RoadmapNodeRow[]> {
  const rows = await sql<
    {
      id: string;
      position: number;
      topic_id: string;
      topic_title: string;
      title: string;
      lesson_id: string | null;
      material_id: string | null;
      outline: unknown;
      outline_edited_at: Date | null;
      rationale: string | null;
      prerequisite_ids: string[] | null;
      material_read_at: Date | null;
      best_check_pct: string | null;
      completed_at: Date | null;
    }[]
  >`
    select n.id, n.position, n.topic_id, t.title_ru as topic_title, n.title,
           n.lesson_id, n.material_id, n.outline, n.outline_edited_at, n.rationale,
           (
             select coalesce(array_agg(tp.prerequisite_id order by tp.prerequisite_id), '{}')
               from public.topic_prerequisites tp
              where tp.topic_id = n.topic_id
           ) as prerequisite_ids,
           lp.material_read_at, lp.best_check_pct, n.completed_at
      from public.roadmap_nodes n
      join public.topics t on t.id = n.topic_id
      left join public.lesson_progress lp
             on lp.lesson_id = n.lesson_id and lp.student_id = ${studentId}
     where n.roadmap_id = ${roadmapId}
     order by n.position, n.id
  `;

  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    title: row.title,
    lessonId: row.lesson_id,
    materialId: row.material_id,
    outline: parseOutline(row.outline),
    outlineEdited: row.outline_edited_at !== null,
    rationale: row.rationale,
    prerequisiteIds: row.prerequisite_ids ?? [],
    materialRead: row.material_read_at !== null,
    bestCheckPct: row.best_check_pct === null ? null : Number(row.best_check_pct),
    completedAt: iso(row.completed_at),
  }));
}

export async function syncNodeStates(
  sql: SqlExecutor,
  states: readonly {
    readonly id: string;
    readonly status: string;
    readonly progressPct: number;
    readonly completed: boolean;
  }[],
): Promise<Map<string, string | null>> {
  
  
  
  const completedAt = new Map<string, string | null>();
  if (states.length === 0) {
    return completedAt;
  }

  
  
  
  const payload = states.map((state) => ({
    id: state.id,
    status: state.status,
    progress_pct: state.progressPct,
    completed: state.completed,
  }));

  const rows = await sql<{ id: string; completed_at: Date | null }[]>`
    update public.roadmap_nodes n
       set status = s.status::public.roadmap_node_status,
           progress_pct = s.progress_pct,
           completed_at = case
             when s.completed then coalesce(n.completed_at, now())
             else null
           end
      from jsonb_to_recordset(${sql.json(payload)}) as s(
        id text, status text, progress_pct numeric, completed boolean
      )
     where n.id = s.id::uuid
       and (n.status <> s.status::public.roadmap_node_status
            or n.progress_pct is distinct from s.progress_pct)
    returning n.id, n.completed_at
  `;

  for (const row of rows) {
    completedAt.set(row.id, iso(row.completed_at));
  }

  return completedAt;
}

export async function syncRoadmapStates(
  sql: SqlExecutor,
  studentId: string,
  roadmapId: string,
): Promise<void> {
  const nodes = await loadRoadmapNodes(sql, studentId, roadmapId);
  const states = unlockNodes(
    nodes.map((node) => ({
      topicId: node.topicId,
      position: node.position,
      prerequisiteIds: node.prerequisiteIds,
      materialRead: node.materialRead,
      bestCheckPct: node.bestCheckPct,
    })),
  );

  const byTopic = new Map(states.map((state) => [state.topicId, state]));

  await syncNodeStates(
    sql,
    nodes.map((node) => {
      const state = byTopic.get(node.topicId);
      return {
        id: node.id,
        status: state?.status ?? 'locked',
        progressPct: state?.progressPct ?? 0,
        completed: state?.completed ?? false,
      };
    }),
  );
}
