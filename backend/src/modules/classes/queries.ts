import type { ClassView } from '../../contracts/dto/classes.js';
import { AppError } from '../../contracts/errors.js';
import type { SqlExecutor } from '../../db/sql.js';

export const CLASS_CHAT_TITLE_PREFIX = 'Чат класса';

interface ClassRow {
  id: string;
  name: string;
  grade: number | null;
  subject_id: string | null;
  subject_code: string | null;
  subject_name: string | null;
  is_archived: boolean;
  member_count: number;
  chat_channel_id: string | null;
  created_at: Date;
}

const CLASS_SELECT = `
  select c.id, c.name, c.grade, c.is_archived, c.created_at,
         s.id as subject_id, s.code as subject_code, s.name_ru as subject_name,
         (
           select count(*)::int from public.class_members m
            where m.class_id = c.id and m.status = 'active'
         ) as member_count,
         (
           select ch.id from public.chat_channels ch
            where ch.class_id = c.id and ch.kind = 'class_chat'
         ) as chat_channel_id
    from public.classes c
    left join public.subjects s on s.id = c.subject_id
`;

export function toClassView(row: ClassRow): ClassView {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    subject:
      row.subject_id === null || row.subject_code === null || row.subject_name === null
        ? null
        : { id: row.subject_id, code: row.subject_code, name: row.subject_name },
    is_archived: row.is_archived,
    member_count: row.member_count,
    chat_channel_id: row.chat_channel_id,
    created_at: row.created_at.toISOString(),
  };
}

export async function listClasses(sql: SqlExecutor, teacherId: string): Promise<ClassView[]> {
  const rows = await sql<ClassRow[]>`
    ${sql.unsafe(CLASS_SELECT)}
     where c.teacher_id = ${teacherId}
     order by c.is_archived, c.created_at desc, c.id
  `;

  return rows.map(toClassView);
}

export async function ownedClass(
  sql: SqlExecutor,
  teacherId: string,
  classId: string,
): Promise<ClassView> {
  const [row] = await sql<ClassRow[]>`
    ${sql.unsafe(CLASS_SELECT)}
     where c.id = ${classId} and c.teacher_id = ${teacherId}
  `;

  if (row === undefined) {
    throw new AppError('NOT_FOUND', { message: 'Класс не найден' });
  }

  return toClassView(row);
}

export interface MemberRow {
  student_id: string;
  public_id: string;
  display_name: string;
  grade: number | null;
  joined_at: Date;
}

export async function listMembers(
  sql: SqlExecutor,
  classId: string,
): Promise<MemberRow[]> {
  return sql<MemberRow[]>`
    select m.student_id, p.public_id, p.display_name, p.grade, m.joined_at
      from public.class_members m
      join public.profiles p on p.id = m.student_id
     where m.class_id = ${classId} and m.status = 'active'
     order by p.display_name, p.public_id
  `;
}
