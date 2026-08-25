import { randomUUID } from 'node:crypto';

import type { SupabaseAdmin } from '../../auth/supabase-admin.js';
import { AVATAR_MAX_BYTES, type MeResponse, type UpdateProfileRequest } from '../../contracts/dto/auth.js';
import { learningGoalSchema, type UserRole } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import { writeAudit } from '../../db/audit.js';
import type { Sql } from '../../db/sql.js';
import type { AuthUser } from '../../types/fastify.js';

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_URL_TTL_SEC = 600;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface ProfileRow {
  id: string;
  role: UserRole;
  public_id: string;
  display_name: string;
  grade: number | null;
  locale: string;
  timezone: string;
  created_at: Date;
  avatar_bucket: string | null;
  avatar_path: string | null;
}

interface StudentRow {
  goal: string | null;
  target_exam_code: string | null;
  target_date: Date | null;
  onboarding_completed_at: Date | null;
  diagnostic_attempt_id: string | null;
  class_name: string | null;
  streak_days: number;
  questions_answered: number;
  ai_usage_count: number;
}

export async function getMe(
  sql: Sql,
  admin: SupabaseAdmin | null,
  user: AuthUser,
): Promise<MeResponse> {
  const [profile] = await sql<ProfileRow[]>`
    select p.id, p.role, p.public_id, p.display_name, p.grade, p.locale, p.timezone, p.created_at,
           f.bucket as avatar_bucket, f.path as avatar_path
      from public.profiles p
      left join public.file_objects f on f.id = p.avatar_file_id
     where p.id = ${user.id}
  `;

  if (profile === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Профиль не найден' });
  }

  let avatarUrl: string | null = null;
  if (admin !== null && profile.avatar_bucket !== null && profile.avatar_path !== null) {
    avatarUrl = await admin
      .createSignedDownloadUrl(profile.avatar_bucket, profile.avatar_path, AVATAR_URL_TTL_SEC)
      .catch(() => null);
  }

  let student: MeResponse['student'] = null;

  if (profile.role === 'student') {
    const [row] = await sql<StudentRow[]>`
      select
        sp.goal::text                                as goal,
        e.code                                       as target_exam_code,
        sp.target_date,
        sp.onboarding_completed_at,
        sp.diagnostic_attempt_id,
        (select c.name
           from public.class_members cm
           join public.classes c on c.id = cm.class_id
          where cm.student_id = ${user.id} and cm.status = 'active'
          order by cm.joined_at desc
          limit 1)                                   as class_name,
        coalesce(st.current_streak, 0)               as streak_days,
        coalesce((select count(*)
                    from public.attempt_answers aa
                    join public.attempts a on a.id = aa.attempt_id
                   where a.student_id = ${user.id}), 0)::int as questions_answered,
        coalesce((select count(*)
                    from public.ai_jobs j
                   where j.student_id = ${user.id}
                     and j.op_type = 'assistant_chat'), 0)::int as ai_usage_count
      from public.profiles p
      left join public.student_profiles sp on sp.student_id = p.id
      left join public.exam_profiles e on e.id = sp.target_exam_id
      left join public.student_streaks st on st.student_id = p.id
      where p.id = ${user.id}
    `;

    const subjects = await sql<{ code: string; name: string; is_profile: boolean }[]>`
      select s.code, s.name_ru as name, ss.is_profile
        from public.student_subjects ss
        join public.subjects s on s.id = ss.subject_id
       where ss.student_id = ${user.id} and ss.removed_at is null
       order by s.sort_order
    `;

    const goal = row?.goal === null || row?.goal === undefined ? null : learningGoalSchema.parse(row.goal);

    student = {
      goal,
      target_exam_code: row?.target_exam_code ?? null,
      target_date: row?.target_date?.toISOString().slice(0, 10) ?? null,
      onboarding_completed_at: row?.onboarding_completed_at?.toISOString() ?? null,
      diagnostic_attempt_id: row?.diagnostic_attempt_id ?? null,
      subjects: subjects.map((subject) => ({
        code: subject.code,
        name: subject.name,
        is_profile: subject.is_profile,
      })),
      class_name: row?.class_name ?? null,
      streak_days: row?.streak_days ?? 0,
      questions_answered: row?.questions_answered ?? 0,
      ai_usage_count: row?.ai_usage_count ?? 0,
    };
  }

  return {
    user_id: profile.id,
    public_id: profile.public_id,
    role: profile.role,
    display_name: profile.display_name,
    grade: profile.grade,
    locale: profile.locale,
    timezone: profile.timezone,
    avatar_url: avatarUrl,
    created_at: profile.created_at.toISOString(),
    requires_onboarding:
      profile.role === 'student' && student?.onboarding_completed_at === null,
    student,
  };
}

export async function updateProfile(
  sql: Sql,
  user: AuthUser,
  input: UpdateProfileRequest,
  requestId: string,
): Promise<void> {
  const [updated] = await sql<{ id: string }[]>`
    update public.profiles
       set display_name = coalesce(${input.display_name ?? null}, display_name),
           grade        = coalesce(${input.grade ?? null}, grade),
           locale       = coalesce(${input.locale ?? null}, locale),
           timezone     = coalesce(${input.timezone ?? null}, timezone)
     where id = ${user.id}
     returning id
  `;

  if (updated === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Профиль не найден' });
  }

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'profile.updated',
    entityType: 'profile',
    entityId: user.id,
    summary: { fields: Object.keys(input) },
    requestId,
  });
}

export interface AvatarUpload {
  readonly fileId: string;
  readonly uploadUrl: string;
  readonly token: string;
  readonly path: string;
  readonly expiresInSec: number;
}

export async function prepareAvatarUpload(
  sql: Sql,
  admin: SupabaseAdmin,
  user: AuthUser,
  input: { mime_type: string; size_bytes: number },
): Promise<AvatarUpload> {
  const extension = MIME_EXTENSIONS[input.mime_type];
  if (extension === undefined) {
    throw new AppError('UNSUPPORTED_FILE_TYPE');
  }
  if (input.size_bytes > AVATAR_MAX_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE');
  }

  const fileId = randomUUID();
  
  
  const path = `${user.id}/${fileId}.${extension}`;

  await sql`
    insert into public.file_objects (id, bucket, path, owner_id, original_name, mime_type, size_bytes, scan_status)
    values (
      ${fileId}, ${AVATAR_BUCKET}, ${path}, ${user.id},
      ${`avatar.${extension}`}, ${input.mime_type}, ${input.size_bytes}, 'pending'
    )
  `;

  const { signedUrl, token } = await admin.createSignedUploadUrl(AVATAR_BUCKET, path);

  return { fileId, uploadUrl: signedUrl, token, path, expiresInSec: 300 };
}

const IMAGE_SIGNATURES: { readonly mime: string; readonly matches: (head: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', matches: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  {
    mime: 'image/png',
    matches: (h) =>
      h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 &&
      h[4] === 0x0d && h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    matches: (h) =>
      h.subarray(0, 4).toString('ascii') === 'RIFF' && h.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

function detectImageMime(head: Buffer): string | null {
  return IMAGE_SIGNATURES.find((signature) => signature.matches(head))?.mime ?? null;
}

export async function commitAvatar(
  sql: Sql,
  admin: SupabaseAdmin,
  user: AuthUser,
  fileId: string,
  requestId: string,
): Promise<void> {
  const [file] = await sql<{ id: string; path: string; mime_type: string; size_bytes: string }[]>`
    select id, path, mime_type, size_bytes
      from public.file_objects
     where id = ${fileId} and owner_id = ${user.id} and bucket = ${AVATAR_BUCKET}
  `;

  if (file === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Файл не найден' });
  }

  
  const { data, error } = await admin.client.storage.from(AVATAR_BUCKET).download(file.path);
  if (error !== null) {
    throw new AppError('NOT_FOUND', { message: 'Файл ещё не загружен' });
  }

  const head = Buffer.from(await data.slice(0, 16).arrayBuffer());
  const actualMime = detectImageMime(head);

  if (actualMime === null || actualMime !== file.mime_type) {
    await admin.removeObject(AVATAR_BUCKET, file.path).catch(() => undefined);
    await sql`update public.file_objects set scan_status = 'rejected' where id = ${fileId}`;
    throw new AppError('UNSUPPORTED_FILE_TYPE', {
      message: 'Содержимое файла не соответствует заявленному типу',
    });
  }

  const [previous] = await sql<{ avatar_file_id: string | null }[]>`
    select avatar_file_id from public.profiles where id = ${user.id}
  `;

  await sql`update public.file_objects set scan_status = 'clean' where id = ${fileId}`;
  await sql`update public.profiles set avatar_file_id = ${fileId} where id = ${user.id}`;

  if (previous?.avatar_file_id != null && previous.avatar_file_id !== fileId) {
    const [old] = await sql<{ path: string }[]>`
      select path from public.file_objects where id = ${previous.avatar_file_id}
    `;
    if (old !== undefined) {
      await admin.removeObject(AVATAR_BUCKET, old.path).catch(() => undefined);
      await sql`delete from public.file_objects where id = ${previous.avatar_file_id}`;
    }
  }

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'profile.avatar_updated',
    entityType: 'profile',
    entityId: user.id,
    requestId,
  });
}

export async function getAvatarUrl(
  sql: Sql,
  admin: SupabaseAdmin,
  user: AuthUser,
): Promise<string | null> {
  const [row] = await sql<{ bucket: string; path: string }[]>`
    select f.bucket, f.path
      from public.profiles p
      join public.file_objects f on f.id = p.avatar_file_id
     where p.id = ${user.id}
  `;

  if (row === undefined) {
    return null;
  }

  return admin.createSignedDownloadUrl(row.bucket, row.path, AVATAR_URL_TTL_SEC);
}
