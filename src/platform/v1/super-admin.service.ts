import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, runWithTenantSession } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../common/idp-client";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { ConsoleGateway } from "./console.gateway";

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly audit: ControlPlaneAuditService,
    private readonly consoleGateway: ConsoleGateway,
  ) {}

  async getTenants() {
    const tenants = await prisma.tenant.findMany({
      include: {
        _count: { select: { organizations: true } },
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      status: t.status,
      demoDataLoaded: t.demoDataLoaded,
      userCount: 0,
      orgCount: t._count.organizations,
      subscription: t.subscription
        ? { planName: t.subscription.plan.name, status: t.subscription.status }
        : null,
      createdAt: t.createdAt,
    }));
  }

  async getTenantDetail(id: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        organizations: true,
        subscription: { include: { plan: true } },
      },
    });

    if (!tenant) throw new NotFoundException("Tenant not found");

    const [userCount, errorCount, auditLogs] = await Promise.all([
      idpPrisma.user.count({ where: { tenantId: id } }),
      prisma.errorLog.count({
        where: { 
          tenantId: id,
          level: { in: ["ERROR", "FATAL"] },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
        }
      }),
      (prisma as any).controlPlaneAuditLog.findMany({
        where: { targetId: id },
        orderBy: { createdAt: "desc" },
        take: 10
      })
    ]);

    return {
      ...tenant,
      metrics: {
        userCount,
        errorsLast24h: errorCount,
        healthStatus: errorCount > 10 ? "DEGRADED" : "HEALTHY",
      },
      auditLogs,
      // apps could be fetched from a module registry table in the future
      apps: ["Core CRM", "Inventory", "Finance", "HR"],
    };
  }

  async provisionTenant(
    data: {
      name: string;
      slug: string;
      plan: string;
      adminEmail: string;
    },
    auditCtx: {
      actorId: string;
      actorRole: string;
      correlationId?: string;
      ipAddress?: string;
    },
  ) {
    return prisma.$transaction(async (tx) => {
      // Audit record is written INSIDE the transaction; a rollback removes it.
      await this.audit.record(
        {
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole,
          action: "tenant.provision",
          details: { name: data.name, slug: data.slug, plan: data.plan, adminEmail: data.adminEmail },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        },
        tx,
      );

      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          plan: data.plan,
          status: "ACTIVE",
        },
      });

      await tx.organization.create({
        data: {
          tenantId: tenant.id,
          name: data.name,
          currency: "USD",
          timezone: "UTC",
          fiscalYearStart: 1,
        },
      });

      const adminRole = await idpPrisma.role.create({
        data: {
          tenantId: tenant.id,
          name: "SUPER_ADMIN",
          isSystem: true,
          permissions: JSON.stringify(["*"]),
        },
      });

      const user = await idpPrisma.user.create({
        data: {
          tenantId: tenant.id,
          email: data.adminEmail.toLowerCase(),
          firstName: "Admin",
          lastName: "",
          status: "INVITED",
        },
      });

      await idpPrisma.userRole.create({
        data: { userId: user.id, roleId: adminRole.id },
      });

      this.consoleGateway.emitTenantUpdate({ action: "created", tenantId: tenant.id });

      return { tenant, user };
    });
  }

  async updateTenant(
    id: string,
    data: Record<string, unknown>,
    auditCtx: {
      actorId: string;
      actorRole: string;
      correlationId?: string;
      ipAddress?: string;
    },
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException("Tenant not found");

    const updateData: Record<string, unknown> = {};
    if (data.plan) updateData.plan = data.plan;
    if (data.status) updateData.status = data.status;
    if (data.name) updateData.name = data.name;

    return prisma.$transaction(async (tx) => {
      await this.audit.record(
        {
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole,
          action: "tenant.update",
          targetId: id,
          details: { before: { plan: tenant.plan, status: tenant.status, name: tenant.name }, after: updateData },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        },
        tx,
      );
      
      const updatedTenant = await (tx as typeof prisma).tenant.update({ where: { id }, data: updateData });
      this.consoleGateway.emitTenantUpdate({ action: "updated", tenantId: id });
      
      return updatedTenant;
    });
  }

  async getAllAdmins() {
    return idpPrisma.user.findMany({
      where: { roles: { some: { role: { name: "SUPER_ADMIN" } } } },
    });
  }

  async getAnalytics() {
    const [tenantCount, activeCount] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { status: "ACTIVE" } }),
    ]);
    return { tenantCount, activeCount };
  }

  async getSystemHealth() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  async impersonateTenant(
    tenantId: string,
    actorId: string,
    auditCtx: { actorId: string; actorRole: string; correlationId?: string; ipAddress?: string }
  ) {
    // 1. Verify TenantConsent exists and is ACTIVE
    const consent = await (prisma as any).tenantConsent.findFirst({
      where: {
        tenantId,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!consent) {
      throw new Error("Cannot impersonate: No active tenant consent found");
    }

    // 2. Find a target user to impersonate (e.g. the primary tenant admin)
    const targetUser = await idpPrisma.user.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "asc" }, // Usually the first user is the founder/admin
    });

    if (!targetUser) {
      throw new Error("No users found in tenant to impersonate");
    }

    // 3. Create ImpersonationSession
    const session = await (prisma as any).impersonationSession.create({
      data: {
        tenantId,
        impersonatorId: actorId,
        targetUserId: targetUser.id,
        consentId: consent.id,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours max
      },
    });

    // 4. Log the impersonation event in audit log (C09 requirement)
    await this.audit.record({
      actorId,
      actorRole: auditCtx.actorRole,
      action: "impersonate",
      targetId: tenantId,
      details: { 
        sessionId: session.id,
        targetUserId: targetUser.id,
        consentId: consent.id
      },
      correlationId: auditCtx.correlationId,
      ipAddress: auditCtx.ipAddress
    });

    // 5. Generate impersonation JWT
    const jwt = require("jsonwebtoken");
    const secret = process.env.JWT_SECRET || "fallback_secret_for_local_dev";
    
    const token = jwt.sign(
      {
        sub: targetUser.id,
        userId: targetUser.id,
        tenantId: targetUser.tenantId,
        email: targetUser.email,
        realm: "tenant",
        roles: ["admin"],
        isImpersonation: true,
        impersonatorId: actorId,
        impersonationSessionId: session.id
      },
      secret,
      { expiresIn: "2h" }
    );

    return { token, session };
  }

  async crossTenantSearch(
    query: string,
    justification: string,
    auditCtx: { actorId: string; actorRole: string; correlationId?: string; ipAddress?: string }
  ) {
    if (!justification || justification.trim().length < 10) {
      throw new Error("A detailed justification (min 10 chars) is required for cross-tenant search.");
    }
    
    // Log the search action
    await this.audit.record({
      actorId: auditCtx.actorId,
      actorRole: auditCtx.actorRole,
      action: "support.cross_tenant_search",
      details: { query, justification },
      correlationId: auditCtx.correlationId,
      ipAddress: auditCtx.ipAddress
    });

    const results: any[] = [];
    const searchString = `%${query}%`;

    // 1. Search Tenants
    const tenants = await prisma.tenant.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { slug: { contains: query, mode: 'insensitive' } },
          { id: query }
        ]
      },
      take: 10
    });
    
    tenants.forEach(t => {
      results.push({ type: 'tenant', id: t.id, title: t.name, subtitle: t.slug, tenantId: t.id });
    });

    // 2. Search Users (IDP)
    const users = await idpPrisma.user.findMany({
      where: {
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { id: query }
        ]
      },
      take: 20
    });

    users.forEach(u => {
      results.push({ type: 'user', id: u.id, title: `${u.firstName} ${u.lastName}`, subtitle: u.email, tenantId: u.tenantId });
    });

    // 3. Search Invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        OR: [
          { invoiceNumber: { contains: query, mode: 'insensitive' } },
          { id: query }
        ]
      },
      take: 20
    });

    invoices.forEach(i => {
      results.push({ type: 'invoice', id: i.id, title: i.invoiceNumber, subtitle: i.id, tenantId: i.tenantId });
    });

    return results;
  }

  async getTenantAuditTrail(tenantId: string, page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where: { tenantId } })
    ]);

    return { data, total, page, limit };
  }

  async exportTenantAuditTrail(tenantId: string): Promise<string> {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 10000 // Limit to last 10k for safety in CSV
    });

    if (!logs.length) return "id,userId,action,entityType,entityId,createdAt\n";

    const header = "id,userId,action,entityType,entityId,createdAt\n";
    const rows = logs.map(l => 
      `${l.id},${l.userId},${l.action},${l.entityType},${l.entityId},${l.createdAt.toISOString()}`
    ).join("\n");

    return header + rows;
  }
}
