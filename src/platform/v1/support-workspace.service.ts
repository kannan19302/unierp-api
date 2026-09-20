import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@kannan19302/database';
import { ControlPlaneAuditService } from './control-plane-audit.service';

/**
 * C20 - Support Workspace
 * Provides tenant health score, error log retrieval, session replay pointers,
 * and L1 ticket resolution capability for Super Admins.
 *
 * G-19: L1 ticket resolution must be idempotent (resolve a ticket without side-effects if already resolved).
 */
@Injectable()
export class SupportWorkspaceService {
  private readonly logger = new Logger(SupportWorkspaceService.name);

  constructor(private readonly audit: ControlPlaneAuditService) {}

  /**
   * Compute tenant health score (0–100) from recent subscription, error log, and usage data.
   */
  async getTenantHealth(tenantId: string) {
    const [tenant, sub, openTickets, usageRecords] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.tenantSubscription.findUnique({ where: { tenantId } }),
      prisma.tenantSupportTicket.count({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.usageRecord.findMany({ where: { tenantId } }),
    ]);

    // Score based on: subscription status (40pts), open tickets (30pts), usage (30pts)
    let score = 100;

    if (!sub || sub.status !== 'ACTIVE') score -= 40;
    score -= Math.min(30, openTickets * 10);

    const exceeded = usageRecords.filter((u) => u.currentValue > u.limitValue).length;
    score -= Math.min(30, exceeded * 15);

    return {
      tenantId,
      name: tenant.name,
      status: tenant.status,
      subscriptionStatus: sub?.status ?? 'NONE',
      healthScore: Math.max(0, score),
      openTickets,
      exceededQuotas: exceeded,
      computedAt: new Date(),
    };
  }

  async listTickets(tenantId: string, status?: string) {
    return prisma.tenantSupportTicket.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * G-19: Idempotent L1 resolution. If ticket is already resolved, returns current state.
   */
  async resolveTicket(ticketId: string, resolution: string, actorId: string) {
    const ticket = await prisma.tenantSupportTicket.findUniqueOrThrow({ where: { id: ticketId } });

    // Idempotency: already resolved → return as-is
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      return { ...ticket, alreadyResolved: true };
    }

    return prisma.$transaction(async (tx) => {
      const resolved = await tx.tenantSupportTicket.update({
        where: { id: ticketId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
        },
      });

      await tx.ticketMessage.create({
        data: {
          ticketId,
          userId: actorId,
          message: `[L1 Resolution] ${resolution}`,
          isStaff: true,
        },
      });

      await this.audit.record(
        {
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'support.ticket.resolve',
          targetId: ticketId,
          details: { resolution, tenantId: ticket.tenantId },
        },
        tx as any,
      );

      return resolved;
    });
  }

  async getSessionReplayPointers(tenantId: string) {
    // Returns pointers to session replay data (stored in tenant settings or external APM)
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const settings = tenant.settings as any;

    return {
      tenantId,
      replayProvider: settings?.apm?.provider ?? 'POSTHOG',
      replayUrl: settings?.apm?.replayUrl ?? `https://posthog.example.com/replay?tenant=${tenantId}`,
      sessionCount: settings?.apm?.sessionCount ?? 0,
      lastRecordedAt: settings?.apm?.lastRecordedAt ?? null,
    };
  }

  // ── Extended Support & Service Operations (PCC-22) ──

  private inMemoryTickets: any[] = [
    {
      id: "tkt-101",
      tenantId: "00000000-0000-0000-0000-000000000001",
      tenantName: "Acme Corp",
      subject: "PostgreSQL Connection Pool Exhaustion under Peak Traffic",
      severity: "CRITICAL",
      category: "INFRASTRUCTURE",
      status: "IN_PROGRESS",
      assignedTo: "staff-lead-devops",
      slaDueAt: new Date(Date.now() + 7200000).toISOString(), // 2 hours remaining
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      messages: [
        {
          id: "msg-1",
          isStaff: false,
          senderName: "Sarah Jenkins (Acme Admin)",
          message: "Our API gateway is returning 500 status codes with 'too many clients already' in Prisma.",
          createdAt: new Date(Date.now() - 7200000).toISOString(),
        },
        {
          id: "msg-2",
          isStaff: true,
          senderName: "DevOps Tier-2 Support",
          message: "Investigating PgBouncer pool sizing and scaling read replicas in us-east-1.",
          createdAt: new Date(Date.now() - 3600000).toISOString(),
        },
      ],
    },
    {
      id: "tkt-102",
      tenantId: "00000000-0000-0000-0000-000000000002",
      tenantName: "Globex Logistics",
      subject: "Webhook Signature Verification Failure on Invoice.Paid",
      severity: "HIGH",
      category: "INTEGRATIONS",
      status: "OPEN",
      assignedTo: "staff-integrations",
      slaDueAt: new Date(Date.now() + 18000000).toISOString(), // 5 hours remaining
      createdAt: new Date(Date.now() - 10800000).toISOString(),
      messages: [
        {
          id: "msg-3",
          isStaff: false,
          senderName: "David Lee (Globex CT)",
          message: "Webhook HMAC SHA256 header does not match secret rotated yesterday.",
          createdAt: new Date(Date.now() - 10800000).toISOString(),
        },
      ],
    },
    {
      id: "tkt-103",
      tenantId: "00000000-0000-0000-0000-000000000003",
      tenantName: "Initech Systems",
      subject: "Requested Seat Quota Increase for Q2 Sales Expansion",
      severity: "LOW",
      category: "BILLING",
      status: "RESOLVED",
      assignedTo: "staff-billing",
      slaDueAt: new Date(Date.now() - 86400000).toISOString(),
      createdAt: new Date(Date.now() - 172800000).toISOString(),
      messages: [
        {
          id: "msg-4",
          isStaff: false,
          senderName: "Peter Gibbons",
          message: "Need 25 additional user licenses added to Enterprise subscription.",
          createdAt: new Date(Date.now() - 172800000).toISOString(),
        },
        {
          id: "msg-5",
          isStaff: true,
          senderName: "Billing Operations",
          message: "Updated quota to 125 seats and prorated invoice issued.",
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
    },
  ];

  private inMemoryConsents: any[] = [
    {
      id: "diag-001",
      tenantId: "00000000-0000-0000-0000-000000000001",
      tenantName: "Acme Corp",
      scope: "READ_ONLY_DATABASE_QUERY",
      reason: "Debug intermittent query lock in invoicing pipeline",
      status: "GRANTED",
      requestedBy: "ops-engineer@unierp.com",
      grantedBy: "sarah@acme.com",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: "diag-002",
      tenantId: "00000000-0000-0000-0000-000000000002",
      tenantName: "Globex Logistics",
      scope: "SESSION_REPLAY_VIEW",
      reason: "Inspect UI checkout freeze reported by procurement clerk",
      status: "PENDING",
      requestedBy: "support-agent@unierp.com",
      expiresAt: new Date(Date.now() + 172800000).toISOString(),
      createdAt: new Date(Date.now() - 1800000).toISOString(),
    },
  ];

  // --- Ticket Management & Triage (EC-22.1) ---

  async listAllTickets(query?: { status?: string; severity?: string }) {
    let list = this.inMemoryTickets;
    if (query?.status) {
      list = list.filter((t) => t.status === query.status);
    }
    if (query?.severity) {
      list = list.filter((t) => t.severity === query.severity);
    }
    return list.map((t) => {
      const remainingMs = new Date(t.slaDueAt).getTime() - Date.now();
      const slaCountdownMinutes = Math.round(remainingMs / 60000);
      return {
        ...t,
        slaCountdownMinutes,
        isBreached: remainingMs < 0 && t.status !== "RESOLVED" && t.status !== "CLOSED",
      };
    });
  }

  async getTicketDetails(ticketId: string) {
    const t = this.inMemoryTickets.find((item) => item.id === ticketId);
    if (!t) throw new NotFoundException(`Ticket ${ticketId} not found`);
    const remainingMs = new Date(t.slaDueAt).getTime() - Date.now();
    return {
      ...t,
      slaCountdownMinutes: Math.round(remainingMs / 60000),
      isBreached: remainingMs < 0 && t.status !== "RESOLVED" && t.status !== "CLOSED",
    };
  }

  async createTicket(input: {
    tenantId: string;
    tenantName?: string;
    subject: string;
    severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    category?: string;
    description: string;
    createdBy?: string;
  }) {
    if (!input.subject || !input.description) {
      throw new Error("Subject and description are required");
    }

    const severity = input.severity || "MEDIUM";
    // SLA hours by severity: CRITICAL = 4h, HIGH = 8h, MEDIUM = 24h, LOW = 72h
    const slaHours = severity === "CRITICAL" ? 4 : severity === "HIGH" ? 8 : severity === "MEDIUM" ? 24 : 72;
    const slaDueAt = new Date(Date.now() + slaHours * 3600000).toISOString();

    const newTicket = {
      id: `tkt-${Date.now()}`,
      tenantId: input.tenantId,
      tenantName: input.tenantName || "Enterprise Tenant",
      subject: input.subject,
      severity,
      category: input.category || "GENERAL",
      status: "OPEN",
      assignedTo: "UNASSIGNED",
      slaDueAt,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: `msg-${Date.now()}`,
          isStaff: false,
          senderName: input.createdBy || "Customer Contact",
          message: input.description,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    this.inMemoryTickets.unshift(newTicket);
    return newTicket;
  }

  async addTicketMessage(ticketId: string, input: { message: string; isStaff: boolean; senderName?: string }) {
    const ticket = this.inMemoryTickets.find((t) => t.id === ticketId);
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);

    const newMsg = {
      id: `msg-${Date.now()}`,
      isStaff: input.isStaff,
      senderName: input.senderName || (input.isStaff ? "Support Staff" : "User"),
      message: input.message,
      createdAt: new Date().toISOString(),
    };

    ticket.messages.push(newMsg);
    if (ticket.status === "OPEN" && input.isStaff) {
      ticket.status = "IN_PROGRESS";
    }
    return newMsg;
  }

  // --- Diagnostic Consent Management (EC-22.3) ---

  async listDiagnosticConsents(tenantId?: string) {
    if (tenantId) {
      return this.inMemoryConsents.filter((c) => c.tenantId === tenantId);
    }
    return this.inMemoryConsents;
  }

  async requestDiagnosticConsent(input: {
    tenantId: string;
    tenantName?: string;
    scope: string;
    durationHours?: number;
    reason: string;
    requestedBy?: string;
  }) {
    if (!input.tenantId || !input.reason) {
      throw new Error("tenantId and reason are required");
    }

    const duration = input.durationHours || 24;
    const expiresAt = new Date(Date.now() + duration * 3600000).toISOString();

    const newConsent = {
      id: `diag-${Date.now()}`,
      tenantId: input.tenantId,
      tenantName: input.tenantName || "Enterprise Tenant",
      scope: input.scope,
      reason: input.reason,
      status: "PENDING",
      requestedBy: input.requestedBy || "staff-engineer@unierp.com",
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    this.inMemoryConsents.unshift(newConsent);
    return newConsent;
  }

  async grantDiagnosticConsent(id: string) {
    const consent = this.inMemoryConsents.find((c) => c.id === id);
    if (!consent) throw new NotFoundException(`Consent request ${id} not found`);
    consent.status = "GRANTED";
    consent.grantedBy = "admin@tenant.com";
    return consent;
  }
}
