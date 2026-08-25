import { createHash } from 'node:crypto';

import type { MaterialView } from '../../contracts/dto/materials.js';
import { materialFormatSchema } from '../../contracts/dto/materials.js';
import { AppError } from '../../contracts/errors.js';
import { parseMarkdown } from '../../contracts/markdown.js';
import type { SqlExecutor } from '../../db/sql.js';

export interface MaterialRow {
  id: string;
  kind: string;
  format: string;
  title: string;
  summary: string | null;
  content_hash: string;
  body_md: string | null;
  external_url: string | null;
  class_id: string | null;
  grade_min: number | null;
  grade_max: number | null;
  est_read_minutes: number | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  subject_id: string | null;
  subject_code: string | null;
  subject_name: string | null;
  file_id: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: string | null;
}

export const MATERIAL_COLUMNS = `
  m.id, m.kind::text as kind, m.format::text as format, m.title, m.summary,
  m.content_hash, m.body_md, m.external_url, m.class_id,
  m.grade_min, m.grade_max, m.est_read_minutes, m.status::text as status,
  m.created_at, m.updated_at,
  s.id as subject_id, s.code as subject_code, s.name_ru as subject_name,
  f.id as file_id, f.original_name as file_name,
  f.mime_type as file_mime, f.size_bytes as file_size
`;

export const MATERIAL_FROM = `
  from public.materials m
  left join public.subjects s on s.id = m.subject_id
  left join public.file_objects f on f.id = m.file_id
`;

export const MATERIAL_SELECT = `select ${MATERIAL_COLUMNS} ${MATERIAL_FROM}`;

export function toMaterialView(row: MaterialRow): MaterialView {
  const kind = row.kind;

  return {
    id: row.id,
    kind:
      kind === 'library' || kind === 'teacher_upload' || kind === 'teacher_link'
        ? kind
        : 'teacher_text',
    format: materialFormatSchema.catch('markdown').parse(row.format),
    title: row.title,
    summary: row.summary,
    content_hash: row.content_hash,
    body_md: row.body_md,
    body_blocks: row.body_md === null ? null : parseMarkdown(row.body_md),
    file:
      row.file_id === null || row.file_name === null || row.file_mime === null
        ? null
        : {
            id: row.file_id,
            original_name: row.file_name,
            mime_type: row.file_mime,
            size_bytes: Number(row.file_size ?? 0),
          },
    external_url: row.external_url,
    subject:
      row.subject_id === null || row.subject_code === null || row.subject_name === null
        ? null
        : { id: row.subject_id, code: row.subject_code, name: row.subject_name },
    class_id: row.class_id,
    grade_min: row.grade_min,
    grade_max: row.grade_max,
    est_read_minutes: row.est_read_minutes,
    status: row.status === 'draft' || row.status === 'blocked' ? row.status : 'published',
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function ownedMaterial(
  sql: SqlExecutor,
  authorId: string,
  materialId: string,
): Promise<MaterialRow> {
  const [row] = await sql<MaterialRow[]>`
    ${sql.unsafe(MATERIAL_SELECT)}
     where m.id = ${materialId} and m.author_id = ${authorId}
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Материал не найден' });
  }

  return row;
}

export function contentHash(payload: {
  readonly bodyMd?: string | null;
  readonly fileId?: string | null;
  readonly externalUrl?: string | null;
}): string {
  const source =
    payload.bodyMd ?? payload.fileId ?? payload.externalUrl ?? '';
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

export function estimateReadMinutes(bodyMd: string): number {
  const words = bodyMd.split(/\s+/u).filter((word) => word.length > 0).length;
  return Math.min(240, Math.max(1, Math.round(words / 200)));
}
