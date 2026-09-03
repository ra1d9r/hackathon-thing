import type {
  AddMemberRequest,
  AddMemberResponse,
  ClassListResponse,
  ClassMembersResponse,
  ClassResponse,
  CreateClassRequest,
  PatchClassRequest,
  RemoveMemberResponse,
} from '../../contracts/dto/classes.js';
import { AppError } from '../../contracts/errors.js';
import { writeAudit } from '../../db/audit.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  CLASS_CHAT_TITLE_PREFIX,
  listClasses,
  listMembers,
  ownedClass,
  type MemberRow,
} from './queries.js';

function requireTeacher(user: AuthUser): void {
  if (user.role !== 'teacher') {
    throw new AppError('FORBIDDEN_ROLE', { message: 'Действие доступно учителю' });
  }
}

function toMemberView(row: MemberRow): AddMemberResponse['student'] {
  return {
    student_id: row.student_id,
    public_id: row.public_id,
    display_name: row.display_name,
    grade: row.grade,
    joined_at: row.joined_at.toISOString(),
  };
}

export async function getClasses(sql: Sql, user: AuthUser): Promise<ClassListResponse> {
  requireTeacher(user);
  const classes = await listClasses(sql, user.id);

  return {
    classes,
    empty_reason: classes.length === 0 ? 'no_classes' : null,
  };
}

async function ensureClassChannel(
  tx: SqlExecutor,
  classId: string,
  className: string,
  teacherId: string,
): Promise<string> {
  await tx`
    insert into public.chat_channels (kind, class_id, title)
    values ('class_chat', ${classId}, ${`${CLASS_CHAT_TITLE_PREFIX}: ${className}`})
    on conflict do nothing
  `;

  const [channel] = await tx<{ id: string }[]>`
    select id from public.chat_channels
     where class_id = ${classId} and kind = 'class_chat'
  `;

  if (channel === undefined) {
    throw new Error('канал чата класса не создан');
  }

  await tx`
    insert into public.chat_channel_members (channel_id, user_id)
    values (${channel.id}, ${teacherId})
    on conflict do nothing
  `;

  return channel.id;
}

export async function createClass(
  sql: Sql,
  user: AuthUser,
  body: CreateClassRequest,
  requestId: string,
): Promise<ClassResponse> {
  requireTeacher(user);

  const subjectId =
    body.subject_code === undefined ? null : await subjectIdByCode(sql, body.subject_code);

  const created = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into public.classes (teacher_id, name, grade, subject_id)
      values (${user.id}, ${body.name.trim()}, ${body.grade ?? null}, ${subjectId})
      returning id
    `;

    if (row === undefined) {
      throw new Error('класс не создан');
    }

    await ensureClassChannel(tx, row.id, body.name.trim(), user.id);
    return row.id;
  });

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'class.created',
    entityType: 'class',
    entityId: created,
    summary: { name: body.name.trim() },
    requestId,
  });

  return { class: await ownedClass(sql, user.id, created) };
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

export async function patchClass(
  sql: Sql,
  user: AuthUser,
  classId: string,
  body: PatchClassRequest,
  requestId: string,
): Promise<ClassResponse> {
  requireTeacher(user);
  await ownedClass(sql, user.id, classId);

  const [row] = await sql<{ id: string }[]>`
    update public.classes
       set name = coalesce(${body.name?.trim() ?? null}, name),
           is_archived = coalesce(${body.is_archived ?? null}, is_archived)
     where id = ${classId} and teacher_id = ${user.id}
    returning id
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Класс не найден' });
  }

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'class.updated',
    entityType: 'class',
    entityId: classId,
    summary: { fields: Object.keys(body) },
    requestId,
  });

  return { class: await ownedClass(sql, user.id, classId) };
}

export async function getMembers(
  sql: Sql,
  user: AuthUser,
  classId: string,
): Promise<ClassMembersResponse> {
  requireTeacher(user);
  const view = await ownedClass(sql, user.id, classId);
  const members = await listMembers(sql, classId);

  return {
    class: view,
    members: members.map(toMemberView),
    empty_reason: members.length === 0 ? 'no_members' : null,
  };
}

export async function addMember(
  sql: Sql,
  user: AuthUser,
  classId: string,
  body: AddMemberRequest,
  requestId: string,
): Promise<AddMemberResponse> {
  requireTeacher(user);
  const view = await ownedClass(sql, user.id, classId);

  const publicId = body.public_id.trim().toUpperCase();

  const [student] = await sql<{ id: string }[]>`
    select id from public.profiles
     where public_id = ${publicId} and role = 'student'
  `;

  if (student === undefined) {
    await writeAudit(sql, {
      actorId: user.id,
      actorRole: user.role,
      action: 'class.member_lookup_failed',
      entityType: 'class',
      entityId: classId,
      requestId,
    });
    throw new AppError('NOT_FOUND', { message: 'Ученик с таким кодом не найден' });
  }

  const [existing] = await sql<{ status: string }[]>`
    select status::text as status from public.class_members
     where class_id = ${classId} and student_id = ${student.id}
  `;

  if (existing?.status === 'active') {
    throw new AppError('STATE_CONFLICT', { message: 'Ученик уже в классе' });
  }

  await sql.begin(async (tx) => {
    await tx`
      insert into public.class_members (class_id, student_id, status, added_by)
      values (${classId}, ${student.id}, 'active', ${user.id})
      on conflict (class_id, student_id)
      do update set status = 'active', removed_at = null, added_by = ${user.id}
    `;

    await tx`
      insert into public.distribution_receipts (distribution_id, student_id)
      select d.id, ${student.id}
        from public.material_distributions d
       where d.class_id = ${classId}
      on conflict do nothing
    `;

    const channelId = await ensureClassChannel(tx, classId, view.name, user.id);
    await tx`
      insert into public.chat_channel_members (channel_id, user_id)
      values (${channelId}, ${student.id})
      on conflict do nothing
    `;
  });

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'class.member_added',
    entityType: 'class',
    entityId: classId,
    summary: { student_id: student.id },
    requestId,
  });

  const members = await listMembers(sql, classId);
  const added = members.find((member) => member.student_id === student.id);

  if (added === undefined) {
    throw new Error('ученик добавлен, но не читается');
  }

  return { student: toMemberView(added) };
}

export async function removeMember(
  sql: Sql,
  user: AuthUser,
  classId: string,
  studentId: string,
  requestId: string,
): Promise<RemoveMemberResponse> {
  requireTeacher(user);
  await ownedClass(sql, user.id, classId);

  const removed = await sql.begin(async (tx) => {
    const rows = await tx<{ student_id: string }[]>`
      update public.class_members
         set status = 'removed', removed_at = now()
       where class_id = ${classId} and student_id = ${studentId} and status = 'active'
      returning student_id
    `;

    if (rows.length > 0) {
      await tx`
        delete from public.chat_channel_members
         where user_id = ${studentId}
           and channel_id in (
             select id from public.chat_channels
              where class_id = ${classId} and kind = 'class_chat'
           )
      `;
    }

    return rows.length > 0;
  });

  if (removed) {
    await writeAudit(sql, {
      actorId: user.id,
      actorRole: user.role,
      action: 'class.member_removed',
      entityType: 'class',
      entityId: classId,
      summary: { student_id: studentId },
      requestId,
    });
  }

  const view = await ownedClass(sql, user.id, classId);

  return { student_id: studentId, removed, member_count: view.member_count };
}
