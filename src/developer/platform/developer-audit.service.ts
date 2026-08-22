import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
@Injectable()
export class DeveloperAuditService {
  private readonly db = prisma as any;
  list(tenantId: string, projectId: string) { return this.db.developerAuditEvent.findMany({ where: { tenantId, projectId }, select: { id: true, action: true, actorId: true, correlationId: true, metadata: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 }); }
  async record(input: { tenantId: string; projectId: string; action: string; actorId?: string | null; correlationId?: string | null; metadata?: Record<string, unknown> }) {
    try { return await this.db.developerAuditEvent.create({ data: { tenantId: input.tenantId, projectId: input.projectId, action: input.action, actorId: input.actorId ?? null, correlationId: input.correlationId ?? null, metadata: input.metadata ?? {} } }); } catch { return null; }
  }
}
