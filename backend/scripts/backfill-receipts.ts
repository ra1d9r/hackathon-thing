import { createSqlClient, DEFAULT_WORKER_STATEMENT_TIMEOUT_MS } from '../src/db/sql.js';
import { getEnv, loadDotEnv } from '../src/env.js';

const MISSING = `
  select d.id as distribution_id, cm.student_id
    from public.material_distributions d
    join public.class_members cm
      on cm.class_id = d.class_id
     and cm.status = 'active'
   where d.class_id is not null
     and not exists (
       select 1
         from public.distribution_receipts r
        where r.distribution_id = d.id
          and r.student_id = cm.student_id
     )
`;

async function main(): Promise<void> {
  loadDotEnv();
  const apply = process.argv.includes('--apply');
  const sql = createSqlClient(getEnv(), { statementTimeoutMs: DEFAULT_WORKER_STATEMENT_TIMEOUT_MS });

  try {
    const missing = await sql<{ distribution_id: string; student_id: string }[]>`
      ${sql.unsafe(MISSING)}
    `;

    if (missing.length === 0) {
      console.log('Пробелов нет: у всех участников классов есть расписки.');
      return;
    }

    const students = new Set(missing.map((row) => row.student_id));
    console.log(
      `Не хватает расписок: ${String(missing.length)} (учеников: ${String(students.size)})`,
    );

    if (!apply) {
      console.log('Это просмотр. Чтобы записать, запустите с флагом --apply.');
      return;
    }

    const inserted = await sql<{ count: string }[]>`
      with missing as (${sql.unsafe(MISSING)})
      insert into public.distribution_receipts (distribution_id, student_id)
      select distribution_id, student_id from missing
      on conflict do nothing
      returning 1 as count
    `;

    console.log(`Записано расписок: ${String(inserted.length)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
