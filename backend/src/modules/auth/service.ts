import type { SupabaseAdmin } from '../../auth/supabase-admin.js';
import type { UserRole } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import type { Sql } from '../../db/sql.js';
import type { Env } from '../../env.js';
import { writeAudit } from '../../db/audit.js';
import type { RegisterRequest, TeacherRequest } from '../../contracts/dto/auth.js';

export interface RegisterResult {
  readonly userId: string;
  readonly publicId: string;
  readonly role: UserRole;
  readonly requiresOnboarding: boolean;
}

export interface TeacherRequestResult {
  readonly requestId: string;
  readonly status: 'pending' | 'approved';
  readonly canRegisterNow: boolean;
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

function isApprovedDomain(env: Env, organizationEmail: string): boolean {
  const domain = domainOf(organizationEmail);
  return env.TEACHER_ORG_DOMAINS.some((allowed) => allowed === domain);
}

export async function submitTeacherRequest(
  sql: Sql,
  env: Env,
  input: TeacherRequest,
  requestId: string,
): Promise<TeacherRequestResult> {
  const approved = isApprovedDomain(env, input.organization_email);
  const status = approved ? 'approved' : 'pending';

  const [row] = await sql<{ id: string }[]>`
    insert into public.teacher_access_requests (
      email, display_name, organization_email, organization_name, message,
      status, decided_at, decided_by
    ) values (
      ${input.email}, ${input.display_name}, ${input.organization_email},
      ${input.organization_name ?? null}, ${input.message ?? null},
      ${status}::public.teacher_request_status,
      ${approved ? sql`now()` : null},
      ${approved ? `домен ${domainOf(input.organization_email)}` : null}
    )
    on conflict (lower(email)) where status in ('pending','approved')
    do update set
      display_name       = excluded.display_name,
      organization_email = excluded.organization_email,
      organization_name  = excluded.organization_name,
      message            = excluded.message
    returning id
  `;

  if (row === undefined) {
    throw new AppError('INTERNAL_ERROR', { message: 'Не удалось сохранить заявку' });
  }

  const [current] = await sql<{ status: string }[]>`
    select status::text from public.teacher_access_requests where id = ${row.id}
  `;

  await writeAudit(sql, {
    action: 'teacher_request.submitted',
    entityType: 'teacher_access_request',
    entityId: row.id,
    summary: { organization_domain: domainOf(input.organization_email), status: current?.status ?? status },
    requestId,
  });

  const finalStatus = current?.status === 'approved' ? 'approved' : 'pending';
  return { requestId: row.id, status: finalStatus, canRegisterNow: finalStatus === 'approved' };
}

async function consumeTeacherApproval(sql: Sql, email: string): Promise<string> {
  const [row] = await sql<{ id: string; status: string }[]>`
    select id, status::text from public.teacher_access_requests
     where lower(email) = ${email} and status in ('pending','approved')
     order by created_at desc
     limit 1
  `;

  if (row === undefined) {
    throw new AppError('FORBIDDEN_ROLE', {
      message: 'Регистрация учителя возможна только по одобренной заявке',
      details: { reason: 'request_required' },
    });
  }

  if (row.status !== 'approved') {
    throw new AppError('FORBIDDEN_ROLE', {
      message: 'Заявка на учительский доступ ещё рассматривается',
      details: { reason: 'request_pending', request_id: row.id },
    });
  }

  return row.id;
}

export async function registerUser(
  sql: Sql,
  admin: SupabaseAdmin,
  input: RegisterRequest,
  requestId: string,
): Promise<RegisterResult> {
  const teacherRequestId =
    input.role === 'teacher' ? await consumeTeacherApproval(sql, input.email) : null;

  const userId = await admin.createUser({ email: input.email, password: input.password });

  try {
    const [profile] = await sql<{ public_id: string }[]>`
      insert into public.profiles (id, role, public_id, display_name, grade)
      values (
        ${userId}, ${input.role}::public.user_role, app.generate_public_id(),
        ${input.display_name}, ${input.grade ?? null}
      )
      returning public_id
    `;

    if (profile === undefined) {
      throw new AppError('INTERNAL_ERROR', { message: 'Профиль не создан' });
    }

    if (teacherRequestId !== null) {
      await sql`
        update public.teacher_access_requests
           set status = 'used', decided_at = coalesce(decided_at, now())
         where id = ${teacherRequestId}
      `;
    }

    await writeAudit(sql, {
      actorId: userId,
      actorRole: input.role,
      action: 'auth.registered',
      entityType: 'profile',
      entityId: userId,
      summary: { role: input.role, public_id: profile.public_id },
      requestId,
    });

    return {
      userId,
      publicId: profile.public_id,
      role: input.role,
      requiresOnboarding: input.role === 'student',
    };
  } catch (cause) {
    await admin.deleteUser(userId).catch(() => undefined);
    throw cause;
  }
}
