import { prisma, runWithTenantSession } from "@kannan19302/database";

/**
 * Central AuditLog emitter for authentication-domain events on the `api`
 * side — mirrors `idp/src/common/audit/emit-auth-audit.ts` (same schema,
 * same `AuditLog` model, both processes share one database). Kept as two
 * copies rather than a shared import because `idp` and `api` do not share a
 * common internal package for guard-level code.
 *
 * Best-effort: a failure to write an audit row must never fail the request
 * whose action it is describing.
 */
export async function emitAuthAudit(params: {
  tenantId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  await runWithTenantSession(
    { tenantId: params.tenantId, userId: params.userId },
    () =>
      prisma.auditLog.create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          changes: (params.changes as any) ?? undefined,
          ipAddress: params.ipAddress ?? null,
        },
      }),
  );
}
