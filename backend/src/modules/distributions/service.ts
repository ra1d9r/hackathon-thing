import type {
  CreateDistributionRequest,
  DistributionListResponse,
  DistributionQuery,
  DistributionResponse,
  DistributionView,
  InboxItemView,
  InboxQuery,
  InboxResponse,
  SeenResponse,
} from '../../contracts/dto/distributions.js';
import { materialFormatSchema } from '../../contracts/dto/materials.js';
import { AppError } from '../../contracts/errors.js';
import { MARKDOWN_LIMITS, normalizeMarkdown } from '../../contracts/markdown.js';
import { writeAudit } from '../../db/audit.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import type { AuthUser } from '../../types/fastify.js';
import {
  MATERIAL_COLUMNS,
  MATERIAL_FROM,
  toMaterialView,
  type MaterialRow,
} from '../materials/queries.js';

function requireTeacher(user: AuthUser): void {
  if (user.role !== 'teacher') {
    throw new AppError('FORBIDDEN_ROLE', { message: 'Действие доступно учителю' });
  }
}

interface DistributionRow {
  id: string;
  material_id: string;
  material_title: string;
  material_format: string;
  class_id: string | null;
  class_name: string | null;
  student_id: string | null;
  message_md: string | null;
  due_at: Date | null;
  created_at: Date;
  seen_count: number;
  recipient_count: number;
}

const DISTRIBUTION_SELECT = `
  select d.id, d.material_id, m.title as material_title, m.format::text as material_format,
         d.class_id, c.name as class_name, d.student_id, d.message_md, d.due_at, d.created_at,
         (
           select count(*)::int from public.distribution_receipts r
            where r.distribution_id = d.id and r.seen_at is not null
         ) as seen_count,
         (
           select count(*)::int from public.distribution_receipts r
            where r.distribution_id = d.id
         ) as recipient_count
    from public.material_distributions d
    join public.materials m on m.id = d.material_id
    left join public.classes c on c.id = d.class_id
`;

function toDistributionView(row: DistributionRow): DistributionView {
  return {
    id: row.id,
    material: {
      id: row.material_id,
      title: row.material_title,
      format: materialFormatSchema.catch('markdown').parse(row.material_format),
    },
    class_id: row.class_id,
    class_name: row.class_name,
    student_id: row.student_id,
    message_md: row.message_md,
    due_at: row.due_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    seen_count: row.seen_count,
    recipient_count: row.recipient_count,
  };
}

export async function createDistribution(
  sql: Sql,
  user: AuthUser,
  body: CreateDistributionRequest,
  requestId: string,
): Promise<DistributionResponse> {
  requireTeacher(user);

  const [material] = await sql<{ id: string; title: string }[]>`
    select id, title from public.materials
     where id = ${body.material_id} and author_id = ${user.id} and status = 'published'
  `;

  if (material === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Материал не найден или снят с публикации' });
  }

  if (body.class_id !== undefined) {
    const [owned] = await sql<{ id: string }[]>`
      select id from public.classes where id = ${body.class_id} and teacher_id = ${user.id}
    `;
    if (owned === undefined) {
      throw new AppError('NOT_FOUND', { message: 'Класс не найден' });
    }
  }

  if (body.student_id !== undefined) {
    const [shared] = await sql<{ student_id: string }[]>`
      select cm.student_id
        from public.class_members cm
        join public.classes c on c.id = cm.class_id
       where cm.student_id = ${body.student_id}
         and cm.status = 'active'
         and c.teacher_id = ${user.id}
       limit 1
    `;
    if (shared === undefined) {
      throw new AppError('NOT_FOUND', { message: 'Ученик не найден среди ваших классов' });
    }
  }

  const note =
    body.message_md === undefined
      ? null
      : normalizeMarkdown(body.message_md, { maxLength: MARKDOWN_LIMITS.note });

  const created = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into public.material_distributions (
        material_id, teacher_id, class_id, student_id, message_md, due_at
      ) values (
        ${body.material_id}, ${user.id},
        ${body.class_id ?? null}, ${body.student_id ?? null},
        ${note}, ${body.due_at ?? null}
      )
      returning id
    `;

    if (row === undefined) {
      throw new Error('рассылка не создана');
    }

    await seedReceipts(tx, row.id, body.class_id ?? null, body.student_id ?? null);
    await announceInClassChat(tx, body.class_id ?? null, material.title, note);
    return row.id;
  });

  await writeAudit(sql, {
    actorId: user.id,
    actorRole: user.role,
    action: 'distribution.created',
    entityType: 'distribution',
    entityId: created,
    summary: { material_id: body.material_id, class_id: body.class_id ?? null },
    requestId,
  });

  const [row] = await sql<DistributionRow[]>`
    ${sql.unsafe(DISTRIBUTION_SELECT)} where d.id = ${created}
  `;

  if (row === undefined) {
    throw new Error('рассылка создана, но не читается');
  }

  return { distribution: toDistributionView(row) };
}

async function announceInClassChat(
  tx: SqlExecutor,
  classId: string | null,
  materialTitle: string,
  note: string | null,
): Promise<void> {
  if (classId === null) return;

  const [channel] = await tx<{ id: string }[]>`
    select id from public.chat_channels
     where class_id = ${classId} and kind = 'class_chat'
  `;

  if (channel === undefined) return;

  const body = note === null
    ? `📎 Новый материал: **${materialTitle}**`
    : `📎 Новый материал: **${materialTitle}**\n\n${note}`;

  await tx`
    insert into public.chat_messages (channel_id, sender_id, sender_kind, body_md, moderation)
    values (${channel.id}, null, 'system', ${body.slice(0, 4000)}, 'allow')
  `;
}

async function seedReceipts(
  tx: SqlExecutor,
  distributionId: string,
  classId: string | null,
  studentId: string | null,
): Promise<void> {
  if (studentId !== null) {
    await tx`
      insert into public.distribution_receipts (distribution_id, student_id)
      values (${distributionId}, ${studentId})
      on conflict do nothing
    `;
    return;
  }

  await tx`
    insert into public.distribution_receipts (distribution_id, student_id)
    select ${distributionId}, cm.student_id
      from public.class_members cm
     where cm.class_id = ${classId} and cm.status = 'active'
    on conflict do nothing
  `;
}

export async function listDistributions(
  sql: Sql,
  user: AuthUser,
  query: DistributionQuery,
): Promise<DistributionListResponse> {
  requireTeacher(user);

  const rows =
    query.class_id === undefined
      ? await sql<DistributionRow[]>`
          ${sql.unsafe(DISTRIBUTION_SELECT)}
           where d.teacher_id = ${user.id}
           order by d.created_at desc, d.id
           limit ${query.limit ?? 50}
        `
      : await sql<DistributionRow[]>`
          ${sql.unsafe(DISTRIBUTION_SELECT)}
           where d.teacher_id = ${user.id} and d.class_id = ${query.class_id}
           order by d.created_at desc, d.id
           limit ${query.limit ?? 50}
        `;

  return {
    distributions: rows.map(toDistributionView),
    empty_reason: rows.length === 0 ? 'no_distributions' : null,
  };
}

interface InboxRow extends MaterialRow {
  distribution_id: string;
  teacher_id: string;
  teacher_name: string;
  dist_class_id: string | null;
  class_name: string | null;
  message_md: string | null;
  due_at: Date | null;
  distributed_at: Date;
  seen_at: Date | null;
  opened_at: Date | null;
}

function toInboxItem(row: InboxRow): InboxItemView {
  return {
    distribution_id: row.distribution_id,
    material: toMaterialView(row),
    teacher: { id: row.teacher_id, display_name: row.teacher_name },
    class_id: row.dist_class_id,
    class_name: row.class_name,
    message_md: row.message_md,
    due_at: row.due_at?.toISOString() ?? null,
    created_at: row.distributed_at.toISOString(),
    seen_at: row.seen_at?.toISOString() ?? null,
    opened_at: row.opened_at?.toISOString() ?? null,
  };
}

const INBOX_SELECT = `
  select ${MATERIAL_COLUMNS},
         d.id as distribution_id, d.teacher_id, t.display_name as teacher_name,
         d.class_id as dist_class_id, c.name as class_name,
         d.message_md, d.due_at, d.created_at as distributed_at,
         r.seen_at, r.opened_at
  ${MATERIAL_FROM}
    join public.material_distributions d on d.material_id = m.id
    join public.distribution_receipts r on r.distribution_id = d.id
    join public.profiles t on t.id = d.teacher_id
    left join public.classes c on c.id = d.class_id
`;

export async function getInbox(
  sql: Sql,
  user: AuthUser,
  query: InboxQuery,
): Promise<InboxResponse> {
  const unreadOnly = query.unread_only === true;

  const rows = await sql<InboxRow[]>`
    ${sql.unsafe(INBOX_SELECT)}
     where r.student_id = ${user.id}
       and m.status = 'published'
       and (${unreadOnly}::boolean = false or r.seen_at is null)
     order by d.created_at desc, d.id
     limit ${query.limit ?? 50}
  `;

  const [unread] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from public.distribution_receipts r
     where r.student_id = ${user.id} and r.seen_at is null
  `;

  return {
    items: rows.map(toInboxItem),
    unread: unread?.n ?? 0,
    empty_reason: rows.length === 0 ? 'no_items' : null,
  };
}

export async function markSeen(
  sql: Sql,
  user: AuthUser,
  distributionId: string,
  opened: boolean,
): Promise<SeenResponse> {
  const [row] = await sql<{ seen_at: Date; opened_at: Date | null }[]>`
    update public.distribution_receipts
       set seen_at = coalesce(seen_at, now()),
           opened_at = case when ${opened}::boolean then coalesce(opened_at, now()) else opened_at end
     where distribution_id = ${distributionId} and student_id = ${user.id}
    returning seen_at, opened_at
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Рассылка не найдена' });
  }

  const [unread] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from public.distribution_receipts r
     where r.student_id = ${user.id} and r.seen_at is null
  `;

  return {
    distribution_id: distributionId,
    seen_at: row.seen_at.toISOString(),
    opened_at: row.opened_at?.toISOString() ?? null,
    unread: unread?.n ?? 0,
  };
}
