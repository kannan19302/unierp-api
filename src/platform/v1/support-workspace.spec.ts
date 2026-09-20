/**
 * Unit tests for SupportWorkspaceService (PCC-22)
 *
 * Verifies:
 * - EC-22.1: Ticket creation and conversation thread management
 * - EC-22.2: SLA target calculation and breach countdown
 * - EC-22.3: Diagnostic consent request, listing, and granting workflow
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupportWorkspaceService } from "./support-workspace.service";

describe("SupportWorkspaceService (PCC-22)", () => {
  let service: SupportWorkspaceService;
  const mockAudit = {
    record: vi.fn(),
  };

  beforeEach(() => {
    service = new SupportWorkspaceService(mockAudit as any);
  });

  describe("EC-22.1: Ticket Creation & Conversation Thread", () => {
    it("lists default operational tickets with messages and SLA countdown", async () => {
      const tickets = await service.listAllTickets();
      expect(tickets.length).toBeGreaterThanOrEqual(3);
      expect(tickets[0].subject).toContain("PostgreSQL Connection Pool");
      expect(tickets[0].messages.length).toBeGreaterThanOrEqual(2);
      expect(tickets[0].slaCountdownMinutes).toBeDefined();
    });

    it("creates a new support ticket and computes SLA target due time", async () => {
      const ticket = await service.createTicket({
        tenantId: "00000000-0000-0000-0000-000000000001",
        tenantName: "Acme Corp",
        subject: "Outbox Relay Dead-Letter Queue Congestion",
        severity: "HIGH",
        category: "INFRASTRUCTURE",
        description: "Dead letter queue contains 45 failed event payloads due to schema version mismatch.",
        createdBy: "Ops Lead",
      });

      expect(ticket.id).toBeDefined();
      expect(ticket.subject).toBe("Outbox Relay Dead-Letter Queue Congestion");
      expect(ticket.severity).toBe("HIGH");
      expect(ticket.status).toBe("OPEN");
      expect(ticket.messages).toHaveLength(1);
      expect(ticket.slaDueAt).toBeDefined();

      // Retrieve details
      const details = await service.getTicketDetails(ticket.id);
      expect(details.id).toBe(ticket.id);
      expect(details.slaCountdownMinutes).toBeGreaterThan(0);
    });

    it("appends reply messages to a ticket conversation thread", async () => {
      const tickets = await service.listAllTickets();
      const target = tickets[0];

      const newMsg = await service.addTicketMessage(target.id, {
        message: "Scaled read replica connection limits from 100 to 300.",
        isStaff: true,
        senderName: "DevOps Engineer",
      });

      expect(newMsg.id).toBeDefined();
      expect(newMsg.message).toContain("Scaled read replica");

      const updated = await service.getTicketDetails(target.id);
      expect(updated.messages.some((m: any) => m.id === newMsg.id)).toBe(true);
    });
  });

  describe("EC-22.2: SLA Timer & Breach Status", () => {
    it("correctly identifies breached tickets past their due date", async () => {
      const tickets = await service.listAllTickets();
      // Ticket tkt-101 has 2 hours remaining, should not be breached
      const tkt101 = tickets.find((t) => t.id === "tkt-101");
      expect(tkt101?.isBreached).toBe(false);
    });
  });

  describe("EC-22.3: Diagnostic Consent Management", () => {
    it("lists active diagnostic consent requests", async () => {
      const consents = await service.listDiagnosticConsents();
      expect(consents.length).toBeGreaterThanOrEqual(2);
      expect(consents[0].scope).toBe("READ_ONLY_DATABASE_QUERY");
      expect(consents[0].status).toBe("GRANTED");
    });

    it("requests diagnostic consent from a tenant and grants access", async () => {
      const consent = await service.requestDiagnosticConsent({
        tenantId: "00000000-0000-0000-0000-000000000001",
        tenantName: "Acme Corp",
        scope: "EPHEMERAL_LOG_STREAM",
        durationHours: 12,
        reason: "Trace missing idempotency key on batch payment sync",
        requestedBy: "lead-support@unierp.com",
      });

      expect(consent.id).toBeDefined();
      expect(consent.status).toBe("PENDING");
      expect(consent.scope).toBe("EPHEMERAL_LOG_STREAM");

      const granted = await service.grantDiagnosticConsent(consent.id);
      expect(granted.status).toBe("GRANTED");
      expect(granted.grantedBy).toBeDefined();
    });
  });
});
