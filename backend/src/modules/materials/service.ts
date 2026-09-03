import { createHash, randomUUID } from 'node:crypto';

import type {
  CreateMaterialRequest,
  FileUrlResponse,
  MaterialListResponse,
  MaterialQuery,
  MaterialResponse,
  PatchMaterialRequest,
  UploadUrlRequest,
  UploadUrlResponse,
} from '../../contracts/dto/materials.js';
import { AppError } from '../../contracts/errors.js';
import { MARKDOWN_LIMITS, sanitizeMarkdown } from '../../contracts/markdown.js';
import type { SupabaseAdmin } from '../../auth/supabase-admin.js';
import { writeAudit } from '../../db/audit.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import {
  CHECKSUM_MAX_BYTES,
  checkMagic,
  MAGIC_HEAD_BYTES,
  specForMime,
  type MaterialFileFormat,
} from '../../domain/files.js';
import { requireExternalUrl } from '../../domain/links.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  contentHash,
  estimateReadMinutes,
  MATERIAL_SELECT,
  ownedMaterial,
  toMaterialView,
  type MaterialRow,
} from './queries.js';

const MATERIALS_BUCKET = 'materials';

const DOWNLOAD_TTL_SEC = 600;

const UPLOAD_TTL_SEC = 300;

function requireTeacher(user: AuthUser): void {
  if (user.role !== 'teacher') {
    throw new AppError('FORBIDDEN_ROLE', { message: 'Действие доступно учителю' });
  }
}

async function requireOwnedClass(
  sql: SqlExecutor,
  teacherId: string,
  classId: string,
): Promise<void> {
  const [row] = await sql<{ id: string }[]>`
    select id from public.classes where id = ${classId} and teacher_id = ${teacherId}
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Класс не найден' });
  }
}

export async function listMaterials(
  sql: Sql,
  user: AuthUser,
  query: MaterialQuery,
): Promise<MaterialListResponse> {
  requireTeacher(user);

  const rows =
    query.class_id === undefined
      ? await sql<MaterialRow[]>`
          ${sql.unsafe(MATERIAL_SELECT)}
           where m.author_id = ${user.id}
           order by m.created_at desc, m.id
           limit ${query.limit ?? 50}
        `
      : await sql<MaterialRow[]>`
          ${sql.unsafe(MATERIAL_SELECT)}
           where m.author_id = ${user.id} and m.class_id = ${query.class_id}
           order by m.created_at desc, m.id
           limit ${query.limit ?? 50}
        `;

  return {
    materials: rows.map(toMaterialView),
    empty_reason: rows.length === 0 ? 'no_materials' : null,
  };
}

export async function getMaterial(
  sql: Sql,
  user: AuthUser,
  materialId: string,
): Promise<MaterialResponse> {
  requireTeacher(user);
  return { material: toMaterialView(await ownedMaterial(sql, user.id, materialId)) };
}

export async function prepareUpload(
  sql: Sql,
  admin: SupabaseAdmin,
  user: AuthUser,
  body: UploadUrlRequest,
): Promise<UploadUrlResponse> {
  requireTeacher(user);

  const spec = specForMime(body.mime_type);
  if (spec === null) {
    throw new AppError('UNSUPPORTED_FILE_TYPE');
  }

  const declared = body.filename.split('.').pop()?.toLowerCase() ?? '';
  if (declared !== spec.extension) {
    throw new AppError('UNSUPPORTED_FILE_TYPE', {
      message: `Расширение .${declared} не отвечает типу ${body.mime_type}`,
    });
  }

  if (body.size_bytes > spec.maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', {
      message: `Файл больше предела для ${spec.format} (${String(
        Math.round(spec.maxBytes / (1024 * 1024)),
      )} МБ)`,
    });
  }

  if (body.class_id !== undefined) {
    await requireOwnedClass(sql, user.id, body.class_id);
  }

  const fileId = randomUUID();
  const folder = body.class_id ?? user.id;
  const path = `${folder}/${fileId}.${spec.extension}`;

  await sql`
    insert into public.file_objects (
      id, bucket, path, owner_id, original_name, mime_type, size_bytes, scan_status
    ) values (
      ${fileId}, ${MATERIALS_BUCKET}, ${path}, ${user.id},
      ${body.filename.slice(0, 200)}, ${body.mime_type}, ${body.size_bytes}, 'pending'
    )
  `;

  const { signedUrl, token } = await admin.createSignedUploadUrl(MATERIALS_BUCKET, path);

  return {
    file_id: fileId,
    upload_url: signedUrl,
    token,
    path,
    expires_in_sec: UPLOAD_TTL_SEC,
    format: spec.format,
  };
}

interface StoredFile {
  readonly id: string;
  readonly path: string;
  readonly mimeType: string;
  readonly declaredSize: number;
}

async function loadPendingFile(
  sql: SqlExecutor,
  ownerId: string,
  fileId: string,
): Promise<StoredFile> {
  const [row] = await sql<
    { id: string; path: string; mime_type: string; size_bytes: string }[]
  >`
    select id, path, mime_type, size_bytes
      from public.file_objects
     where id = ${fileId} and owner_id = ${ownerId} and bucket = ${MATERIALS_BUCKET}
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Файл не найден' });
  }

  return {
    id: row.id,
    path: row.path,
    mimeType: row.mime_type,
    declaredSize: Number(row.size_bytes),
  };
}

async function verifyUploaded(
  admin: SupabaseAdmin,
  file: StoredFile,
  format: MaterialFileFormat,
): Promise<{ head: Uint8Array; actualSize: number | null }> {
  const url = await admin.createSignedDownloadUrl(MATERIALS_BUCKET, file.path, 60);

  const response = await fetch(url, { headers: { Range: `bytes=0-${MAGIC_HEAD_BYTES - 1}` } });
  if (!response.ok && response.status !== 206) {
    throw new AppError('NOT_FOUND', { message: 'Файл ещё не загружен' });
  }

  const head = new Uint8Array(await response.arrayBuffer());

  const range = response.headers.get('content-range');
  const total = range === null ? null : Number(range.split('/')[1] ?? '');
  const actualSize = total !== null && Number.isFinite(total) ? total : null;

  const verdict = checkMagic(format, head);
  if (!verdict.ok) {
    throw new AppError('UNSUPPORTED_FILE_TYPE', {
      message: `Содержимое не отвечает заявленному типу: ${verdict.reason ?? ''}`,
    });
  }

  return { head, actualSize };
}

async function checksumIfSmall(
  admin: SupabaseAdmin,
  file: StoredFile,
  size: number,
): Promise<string | null> {
  if (size > CHECKSUM_MAX_BYTES) {
    return null;
  }

  const { data, error } = await admin.client.storage.from(MATERIALS_BUCKET).download(file.path);
  if (error !== null) {
    return null;
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  return createHash('sha256').update(bytes).digest('hex');
}

export async function createMaterial(
  sql: Sql,
  admin: SupabaseAdmin | null,
  user: AuthUser,
  body: CreateMaterialRequest,
  requestId: string,
): Promise<MaterialResponse> {
  requireTeacher(user);

  if (body.class_id !== undefined) {
    await requireOwnedClass(sql, user.id, body.class_id);
  }

  const subjectId =
    body.subject_code === undefined ? null : await subjectIdByCode(sql, body.subject_code);

  if (
    body.grade_min !== undefined &&
    body.grade_max !== undefined &&
    body.grade_min > body.grade_max
  ) {
    throw new AppError('VALIDATION_FAILED', { message: 'Нижний класс больше верхнего' });
  }

  let kind: string;
  let format: string;
  let bodyMd: string | null = null;
  let externalUrl: string | null = null;
  let fileId: string | null = null;
  let estMinutes: number | null = null;

  if (body.format === 'markdown') {
    const sanitized = sanitizeMarkdown(body.body_md, { maxLength: MARKDOWN_LIMITS.material });
    if (sanitized.bodyMd === '') {
      throw new AppError('VALIDATION_FAILED', { message: 'После очистки текст пуст' });
    }
    kind = 'teacher_text';
    format = 'markdown';
    bodyMd = sanitized.bodyMd;
    estMinutes = estimateReadMinutes(sanitized.bodyMd);
  } else if (body.format === 'link') {
    kind = 'teacher_link';
    format = 'link';
    externalUrl = requireExternalUrl(body.external_url);
  } else {
    if (admin === null) {
      throw new AppError('INTERNAL_ERROR', { message: 'Хранилище файлов недоступно' });
    }

    const file = await loadPendingFile(sql, user.id, body.file_id);
    const spec = specForMime(file.mimeType);

    if (spec?.format !== body.format) {
      throw new AppError('UNSUPPORTED_FILE_TYPE', {
        message: 'Заявленный формат не отвечает типу загруженного файла',
      });
    }

    const { actualSize } = await verifyUploaded(admin, file, spec.format);

    if (actualSize !== null && actualSize > spec.maxBytes) {
      await admin.removeObject(MATERIALS_BUCKET, file.path).catch(() => undefined);
      await sql`update public.file_objects set scan_status = 'rejected' where id = ${file.id}`;
      throw new AppError('PAYLOAD_TOO_LARGE', { message: 'Файл больше заявленного предела' });
    }

    const checksum = await checksumIfSmall(admin, file, actualSize ?? file.declaredSize);

    kind = 'teacher_upload';
    format = spec.format;
    fileId = file.id;

    await sql`
      update public.file_objects
         set scan_status = 'clean',
             checksum_sha256 = ${checksum},
             size_bytes = ${actualSize ?? file.declaredSize}
       where id = ${file.id}
    `;
  }

  const hash = contentHash({ bodyMd, fileId, externalUrl });

  const created = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into public.materials (
        kind, format, subject_id, grade_min, grade_max, title, summary,
        body_md, file_id, external_url, author_id, class_id, status,
        content_hash, est_read_minutes
      ) values (
        ${kind}::public.material_kind,
        ${format}::public.material_format,
        ${subjectId},
        ${body.grade_min ?? null},
        ${body.grade_max ?? null},
        ${body.title.trim()},
        ${body.summary ?? null},
        ${bodyMd},
        ${fileId},
        ${externalUrl},
        ${user.id},
        ${body.class_id ?? null},
        'published',
        ${hash},
        ${estMinutes}
      )
      returning id
    `;

    if (row === undefined) {
      throw new Error('материал не создан');
    }

    if (body.topic_ids !== undefined && body.topic_ids.length > 0) {
      await tx`
        insert into public.material_topics (material_id, topic_id)
        select ${row.id}, t.id
          from public.topics t
         where t.id = any(${[...body.topic_ids]}::uuid[]) and t.is_active
        on conflict do nothing
      `;
    }

    return row.id;
  });

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'material.created',
    entityType: 'material',
    entityId: created,
    summary: { format, class_id: body.class_id ?? null },
    requestId,
  });

  return { material: toMaterialView(await ownedMaterial(sql, user.id, created)) };
}

async function subjectIdByCode(sql: SqlExecutor, code: string): Promise<string> {
  const [subject] = await sql<{ id: string }[]>`
    select id from public.subjects where code = ${code} and is_active
  `;

  if (subject === undefined) {
    throw new AppError('VALIDATION_FAILED', { message: 'Такого предмета нет' });
  }

  return subject.id;
}

export async function patchMaterial(
  sql: Sql,
  user: AuthUser,
  materialId: string,
  body: PatchMaterialRequest,
  requestId: string,
): Promise<MaterialResponse> {
  requireTeacher(user);
  const current = await ownedMaterial(sql, user.id, materialId);

  if (body.body_md !== undefined && current.format !== 'markdown') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Текст есть только у материала с разметкой',
    });
  }

  const sanitized =
    body.body_md === undefined
      ? null
      : sanitizeMarkdown(body.body_md, { maxLength: MARKDOWN_LIMITS.material });

  if (sanitized !== null && sanitized.bodyMd === '') {
    throw new AppError('VALIDATION_FAILED', { message: 'После очистки текст пуст' });
  }

  const nextBody = sanitized?.bodyMd ?? current.body_md;

  await sql`
    update public.materials
       set title = coalesce(${body.title?.trim() ?? null}, title),
           summary = coalesce(${body.summary ?? null}, summary),
           body_md = ${nextBody},
           status = coalesce(${body.status ?? null}::public.material_status, status),
           content_hash = ${contentHash({
             bodyMd: nextBody,
             fileId: current.file_id,
             externalUrl: current.external_url,
           })},
           est_read_minutes = ${
             sanitized === null ? current.est_read_minutes : estimateReadMinutes(sanitized.bodyMd)
           },
           version = version + 1
     where id = ${materialId} and author_id = ${user.id}
  `;

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'material.updated',
    entityType: 'material',
    entityId: materialId,
    summary: { fields: Object.keys(body) },
    requestId,
  });

  return { material: toMaterialView(await ownedMaterial(sql, user.id, materialId)) };
}

export async function deleteMaterial(
  sql: Sql,
  user: AuthUser,
  materialId: string,
  requestId: string,
): Promise<void> {
  requireTeacher(user);
  const current = await ownedMaterial(sql, user.id, materialId);

  await sql`delete from public.materials where id = ${materialId} and author_id = ${user.id}`;

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'material.deleted',
    entityType: 'material',
    entityId: materialId,
    summary: { title: current.title, format: current.format },
    requestId,
  });
}

export async function getFileUrl(
  sql: Sql,
  admin: SupabaseAdmin,
  user: AuthUser,
  fileId: string,
): Promise<FileUrlResponse> {
  const [file] = await sql<
    {
      path: string;
      bucket: string;
      original_name: string;
      mime_type: string;
      size_bytes: string;
      visible: boolean;
    }[]
  >`
    select f.path, f.bucket, f.original_name, f.mime_type, f.size_bytes,
           (
             f.owner_id = ${user.id}
             or exists (
               select 1
                 from public.materials m
                 join public.material_distributions d on d.material_id = m.id
                 left join public.class_members cm
                        on cm.class_id = d.class_id
                       and cm.student_id = ${user.id}
                       and cm.status = 'active'
                where m.file_id = f.id
                  and (d.student_id = ${user.id} or cm.student_id is not null)
             )
           ) as visible
      from public.file_objects f
     where f.id = ${fileId} and f.scan_status = 'clean'
  `;

  if (file?.visible !== true) {
    throw new AppError('NOT_FOUND', { message: 'Файл не найден' });
  }

  const url = await admin.createSignedDownloadUrl(file.bucket, file.path, DOWNLOAD_TTL_SEC);

  return {
    url,
    expires_in_sec: DOWNLOAD_TTL_SEC,
    original_name: file.original_name,
    mime_type: file.mime_type,
    size_bytes: Number(file.size_bytes),
  };
}
