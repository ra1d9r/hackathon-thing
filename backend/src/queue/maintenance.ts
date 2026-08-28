import type { FastifyBaseLogger } from 'fastify';

import type { SupabaseAdmin } from '../auth/supabase-admin.js';
import { writeAudit } from '../db/audit.js';
import type { Sql } from '../db/sql.js';
import { submitAttempt } from '../modules/attempts/service.js';

export interface MaintenanceReport {
  readonly reclaimed: number;
  readonly autoSubmitted: number;
  readonly idempotencyKeysRemoved: number;
  readonly orphanFilesRemoved: number;
  readonly prioritiesRefreshed: number;
}

const AUTOSUBMIT_BATCH = 25;

const ORPHAN_FILE_AGE = '1 day';

const PRIORITY_STALE_AFTER = '20 hours';

async function autoSubmitExpired(sql: Sql, log: FastifyBaseLogger): Promise<number> {
  const expired = await sql<{ id: string; student_id: string; answered: number }[]>`
    select a.id, a.student_id,
           (select count(*)::int from public.attempt_answers aa
             where aa.attempt_id = a.id) as answered
      from public.attempts a
     where a.status = 'in_progress'
       and a.deadline_at is not null
       and a.deadline_at < now()
     order by a.deadline_at
     limit ${AUTOSUBMIT_BATCH}
  `;

  let submitted = 0;

  for (const attempt of expired) {
    try {
      if (attempt.answered === 0) {
        await sql`
          update public.attempts
             set status = 'abandoned'
           where id = ${attempt.id} and status = 'in_progress'
        `;

        await writeAudit(sql, {
          action: 'attempt.autoabandon',
          entityType: 'attempt',
          entityId: attempt.id,
          summary: { reason: 'deadline_expired_no_answers' },
        });
      } else {
        await submitAttempt(
          sql,
          { id: attempt.student_id, role: 'student' },
          attempt.id,
          { automatic: true },
        );
      }
      submitted += 1;
    } catch (error: unknown) {
      log.warn({ err: error, attempt_id: attempt.id }, 'автоотправка попытки не выполнена');
    }
  }

  return submitted;
}

async function removeOrphanFiles(
  sql: Sql,
  admin: SupabaseAdmin | null,
  log: FastifyBaseLogger,
): Promise<number> {
  const orphans = await sql<{ id: string; bucket: string; path: string }[]>`
    delete from public.file_objects f
     where f.scan_status = 'pending'
       and f.created_at < now() - ${ORPHAN_FILE_AGE}::interval
       and not exists (select 1 from public.profiles p where p.avatar_file_id = f.id)
       and not exists (select 1 from public.materials m where m.file_id = f.id)
    returning f.id, f.bucket, f.path
  `;

  if (admin !== null) {
    for (const orphan of orphans) {
      await admin.removeObject(orphan.bucket, orphan.path).catch((error: unknown) => {
        log.warn({ err: error, path: orphan.path }, 'объект хранилища не удалён');
      });
    }
  }

  return orphans.length;
}

export interface MaintenanceOptions {
  readonly admin?: SupabaseAdmin | null;
}

export async function runMaintenance(
  sql: Sql,
  log: FastifyBaseLogger,
  options: MaintenanceOptions = {},
): Promise<MaintenanceReport> {
  const [reclaimRow] = await sql<{ reclaim_stale_jobs: number }[]>`
    select app.reclaim_stale_jobs()
  `;

  const [priorityRow] = await sql<{ refresh_priorities: number }[]>`
    select app.refresh_priorities(${PRIORITY_STALE_AFTER}::interval)
  `;

  const autoSubmitted = await autoSubmitExpired(sql, log);

  const expiredKeys = await sql<{ id: string }[]>`
    delete from public.idempotency_keys where expires_at < now() returning id
  `;

  const orphanFilesRemoved = await removeOrphanFiles(sql, options.admin ?? null, log);

  return {
    reclaimed: reclaimRow?.reclaim_stale_jobs ?? 0,
    autoSubmitted,
    idempotencyKeysRemoved: expiredKeys.length,
    orphanFilesRemoved,
    prioritiesRefreshed: priorityRow?.refresh_priorities ?? 0,
  };
}
