import type { UserRole } from '../contracts/domain.js';
import type { JsonObject } from '../contracts/json.js';
import type { SqlExecutor } from './sql.js';

export interface AuditEntry {
  readonly actorId?: string;
  readonly actorRole?: UserRole;
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string;
  readonly summary?: JsonObject;
  readonly requestId?: string;
}

export async function writeAudit(sql: SqlExecutor, entry: AuditEntry): Promise<void> {
  await sql`
    insert into public.audit_log (actor_id, actor_role, action, entity_type, entity_id, summary, request_id)
    values (
      ${entry.actorId ?? null},
      ${entry.actorRole ?? null},
      ${entry.action},
      ${entry.entityType},
      ${entry.entityId ?? null},
      ${sql.json(entry.summary ?? {})},
      ${entry.requestId ?? null}
    )
  `;
}
