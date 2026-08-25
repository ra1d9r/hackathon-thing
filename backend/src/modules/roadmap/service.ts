import type { z } from 'zod';

import {
  roadmapNodeStatusSchema,
  type RoadmapNodeOutlineRequest,
  type RoadmapNodeView,
  type RoadmapRegenerateRequest,
  type roadmapNodeResponseSchema,
  type roadmapRegenerateResponseSchema,
  type roadmapResponseSchema,
} from '../../contracts/dto/roadmap.js';
import { AppError } from '../../contracts/errors.js';
import { tenToFiveGrade } from '../../contracts/domain.js';
import type { Sql } from '../../db/sql.js';
import { replanBucket, unlockNodes, overallProgressPct } from '../../domain/roadmap.js';
import { enqueueJob, pollUrl, SUGGESTED_WAIT_MS } from '../../queue/jobs.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  loadActiveRoadmap,
  loadRoadmapNodes,
  syncNodeStates,
  type RoadmapHeader,
  type RoadmapNodeRow,
} from './queries.js';

export type RoadmapResponse = z.infer<typeof roadmapResponseSchema>;
export type RoadmapNodeResponse = z.infer<typeof roadmapNodeResponseSchema>;
export type RoadmapRegenerateResponse = z.infer<typeof roadmapRegenerateResponseSchema>;

async function requireDiagnostic(sql: Sql, studentId: string): Promise<void> {
  const [profile] = await sql<{ diagnostic_attempt_id: string | null }[]>`
    select diagnostic_attempt_id from public.student_profiles where student_id = ${studentId}
  `;

  if (profile === undefined) {
    throw new AppError('ONBOARDING_INCOMPLETE');
  }

  
  
  if (profile.diagnostic_attempt_id === null) {
    throw new AppError('DIAGNOSTIC_REQUIRED');
  }
}

interface SubjectChoice {
  readonly subjectId: string;
  readonly code: string;
  readonly name: string;
}

async function resolveSubject(
  sql: Sql,
  studentId: string,
  subjectId: string | undefined,
): Promise<SubjectChoice | null> {
  const rows = await sql<{ id: string; code: string; name_ru: string }[]>`
    select s.id, s.code, s.name_ru
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
     where ss.student_id = ${studentId}
       and ss.removed_at is null
       and s.is_active
       and (${subjectId ?? null}::uuid is null or s.id = ${subjectId ?? null}::uuid)
     order by s.sort_order, s.code
     limit 1
  `;

  const row = rows[0];
  return row === undefined
    ? null
    : { subjectId: row.id, code: row.code, name: row.name_ru };
}

function toNodeView(
  node: RoadmapNodeRow,
  status: string,
  progressPct: number,
  completedAt: string | null,
): RoadmapNodeView {
  return {
    id: node.id,
    position: node.position,
    title: node.title,
    topic: { id: node.topicId, title: node.topicTitle },
    
    
    
    status: roadmapNodeStatusSchema.catch('locked').parse(status),
    progress_pct: progressPct,
    lesson_id: node.lessonId,
    outline: node.outline,
    outline_edited: node.outlineEdited,
    rationale: node.rationale,
    
    
    topics_covered: [{ id: node.topicId, title: node.topicTitle }],
    completed_at: completedAt,
  };
}

interface ResolvedNodes {
  readonly views: RoadmapNodeView[];
  readonly overall: number;
}

async function resolveNodes(
  sql: Sql,
  nodes: readonly RoadmapNodeRow[],
): Promise<ResolvedNodes> {
  const unlocked = unlockNodes(
    nodes.map((node) => ({
      topicId: node.topicId,
      position: node.position,
      prerequisiteIds: node.prerequisiteIds,
      materialRead: node.materialRead,
      bestCheckPct: node.bestCheckPct,
    })),
  );

  const byTopic = new Map(unlocked.map((state) => [state.topicId, state]));

  const completedAt = await syncNodeStates(
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

  const views = nodes.map((node) => {
    const state = byTopic.get(node.topicId);
    return toNodeView(
      node,
      state?.status ?? 'locked',
      state?.progressPct ?? 0,
      completedAt.has(node.id) ? (completedAt.get(node.id) ?? null) : node.completedAt,
    );
  });

  return { views, overall: overallProgressPct(unlocked.map((state) => state)) };
}

async function predictedScoreFor(
  sql: Sql,
  studentId: string,
): Promise<RoadmapResponse['predicted_score']> {
  const [row] = await sql<
    { value: string; max_value: string; scale_kind: string }[]
  >`
    select value, max_value, scale_kind
      from public.predicted_scores
     where student_id = ${studentId}
     order by computed_at desc, id desc
     limit 1
  `;

  if (row === undefined) {
    return null;
  }

  const value = Number(row.value);
  const scale = row.scale_kind === 'ten' ? 'ten' : 'points';

  return {
    scale,
    value,
    max: Number(row.max_value),
    grade_5: scale === 'ten' ? tenToFiveGrade(value) : null,
  };
}

export async function getRoadmap(
  sql: Sql,
  user: AuthUser,
  subjectId: string | undefined,
): Promise<RoadmapResponse> {
  await requireDiagnostic(sql, user.id);

  const subject = await resolveSubject(sql, user.id, subjectId);
  if (subject === null) {
    return { roadmap: null, nodes: [], predicted_score: null, empty_reason: 'subject_not_selected' };
  }

  const header = await loadActiveRoadmap(sql, user.id, subject.subjectId);
  if (header === null) {
    return {
      roadmap: null,
      nodes: [],
      predicted_score: await predictedScoreFor(sql, user.id),
      empty_reason: 'not_generated',
    };
  }

  const nodes = await loadRoadmapNodes(sql, user.id, header.id);
  const { views, overall } = await resolveNodes(sql, nodes);

  return {
    roadmap: {
      id: header.id,
      subject: { id: subject.subjectId, code: subject.code, name: subject.name },
      version: header.version,
      generated_at: header.generatedAt,
      overall_progress_pct: overall,
      source: header.aiJobId === null ? 'fallback' : 'ai',
      replan_reason: header.replanReason,
    },
    nodes: views,
    predicted_score: await predictedScoreFor(sql, user.id),
    empty_reason: views.length === 0 ? 'no_topics' : null,
  };
}

interface NodeOwner {
  readonly node: RoadmapNodeRow;
  readonly header: RoadmapHeader;
  readonly siblings: readonly RoadmapNodeRow[];
}

async function loadNodeOwned(sql: Sql, studentId: string, nodeId: string): Promise<NodeOwner> {
  const [row] = await sql<{ roadmap_id: string; subject_id: string }[]>`
    select n.roadmap_id, r.subject_id
      from public.roadmap_nodes n
      join public.roadmaps r on r.id = n.roadmap_id
     where n.id = ${nodeId} and r.student_id = ${studentId}
     limit 1
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND');
  }

  const header = await loadActiveRoadmap(sql, studentId, row.subject_id);
  const nodes = await loadRoadmapNodes(sql, studentId, row.roadmap_id);
  const node = nodes.find((candidate) => candidate.id === nodeId);

  if (node === undefined || header === null) {
    throw new AppError('NOT_FOUND');
  }

  return { node, header, siblings: nodes };
}

export async function getRoadmapNode(
  sql: Sql,
  user: AuthUser,
  nodeId: string,
): Promise<RoadmapNodeResponse> {
  const owned = await loadNodeOwned(sql, user.id, nodeId);
  const { views } = await resolveNodes(sql, owned.siblings);
  const view = views.find((candidate) => candidate.id === nodeId);

  if (view === undefined) {
    throw new AppError('NOT_FOUND');
  }

  return {
    node: view,
    roadmap: {
      id: owned.header.id,
      subject: {
        id: owned.header.subjectId,
        code: owned.header.subjectCode,
        name: owned.header.subjectName,
      },
      version: owned.header.version,
    },
  };
}

export async function updateNodeOutline(
  sql: Sql,
  user: AuthUser,
  nodeId: string,
  body: RoadmapNodeOutlineRequest,
): Promise<RoadmapNodeResponse> {
  await loadNodeOwned(sql, user.id, nodeId);

  const steps = [...body.outline]
    .sort((a, b) => a.step - b.step)
    .map((step, index) => ({ ...step, step: index + 1 }));

  await sql`
    update public.roadmap_nodes
       set outline = ${sql.json(steps)},
           outline_edited_at = now()
     where id = ${nodeId}
  `;

  return getRoadmapNode(sql, user, nodeId);
}

export async function regenerateRoadmap(
  sql: Sql,
  user: AuthUser,
  body: RoadmapRegenerateRequest,
): Promise<RoadmapRegenerateResponse> {
  await requireDiagnostic(sql, user.id);

  const subject = await resolveSubject(sql, user.id, body.subject_id);
  if (subject === null) {
    throw new AppError('NOT_FOUND');
  }

  
  
  
  const job = await enqueueJob(sql, {
    opType: 'roadmap_plan',
    requestedBy: user.id,
    studentId: user.id,
    dedupeKey: `roadmap_plan:${user.id}:${subject.subjectId}:${replanBucket()}`,
    input: {
      student_id: user.id,
      subject_id: subject.subjectId,
      reason: body.reason ?? null,
    },
  });

  return {
    job_id: job.id,
    status: job.status,
    poll_url: pollUrl(job.id),
    suggested_wait_ms: SUGGESTED_WAIT_MS.roadmap_plan,
    created: job.created,
  };
}
