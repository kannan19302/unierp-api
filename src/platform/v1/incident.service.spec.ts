/**
 * M35 exit criterion (end-to-end half): "A breached SLO opens an
 * incident, notifies affected tenants through C21, and produces an SLA
 * credit that reaches C16 as an adjustment... A simulated breach runs
 * the path end to end."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let slos: any[];
let incidents: any[];
let invoices: any[];
let lineItems: any[];
let auditLogs: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => {
  const mockPrisma: any = {
    sloDefinition: {
      findUnique: vi.fn(({ where: { id } }: any) => slos.find((s) => s.id === id) ?? null),
    },
    incident: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("incident"), openedAt: new Date(), resolvedAt: null, invoiceAdjustmentId: null, ...data };
        incidents.push(row);
        return row;
      }),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = incidents.find((i) => i.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    saaSInvoice: {
      findUniqueOrThrow: vi.fn(({ where: { id } }: any) => {
        const row = invoices.find((i) => i.id === id);
        if (!row) throw new Error("invoice not found");
        return row;
      }),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = invoices.find((i) => i.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    saaSInvoiceLineItem: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("line"), ...data };
        lineItems.push(row);
        return row;
      }),
    },
    controlPlaneAuditLog: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("audit"), ...data };
        auditLogs.push(row);
        return row;
      }),
    },
  };
  mockPrisma.$transaction = vi.fn((cb: any) => cb(mockPrisma));
  return { prisma: mockPrisma };
});

import { EventEmitter2 } from "@nestjs/event-emitter";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { InvoicingService } from "./invoicing.service";
import { IncidentService } from "./incident.service";

describe("M35 · incidents, SLO/SLA, error budgets — end to end", () => {
  let incidentSvc: IncidentService;
  let invoicing: InvoicingService;
  let emitter: EventEmitter2;

  beforeEach(() => {
    vi.clearAllMocks();
    slos = [];
    incidents = [];
    invoices = [];
    lineItems = [];
    auditLogs = [];

    slos.push({ id: "slo-1", service: "api-gateway", tenantId: "tenant-1", targetPercent: 99.9, monthlyFee: { toString: () => "1000.00" } });
    invoices.push({ id: "inv-1", tenantId: "tenant-1", status: "PENDING", notes: "" });

    invoicing = new InvoicingService(new ControlPlaneAuditService());
    emitter = new EventEmitter2();
    incidentSvc = new IncidentService(invoicing, emitter);
  });

  it("a simulated breach runs the path END TO END: opens an incident, notifies via C21, and applies an SLA credit to C16 as an adjustment", async () => {
    const notified: any[] = [];
    emitter.on("notification.send", (payload) => notified.push(payload));

    const result = await incidentSvc.simulateBreach("slo-1", "inv-1", 97.0, "system:sla-monitor");

    // 1. Incident opened.
    expect(incidents).toHaveLength(1);
    expect(incidents[0].status).toBe("OPEN");
    expect(incidents[0].severity).toBe("MAJOR");

    // 2. Notified through C21 -- the SAME event contract
    // NotificationDeliveryService listens for, not a bespoke channel.
    expect(notified).toHaveLength(1);
    expect(notified[0].tenantId).toBe("tenant-1");
    expect(notified[0].type).toBe("SLA_BREACH");
    expect(result.notified).toBe(true);

    // 3. SLA credit computed from the 100%-covered pure arithmetic.
    expect(result.creditAmount).toBe("250.0000"); // 25% of 1000.00 at 97%

    // 4. Reaches C16 as a REAL invoice adjustment -- a genuine credit
    // line item on the invoice, not a separate ledger.
    expect(result.adjustment).not.toBeNull();
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].type).toBe("CREDIT");
    expect(Number(lineItems[0].totalPrice)).toBe(-250);
    expect(incidents[0].invoiceAdjustmentId).toBe("inv-1");
  });

  it("a breach that still clears the top tier (>= 99.90%) opens no incident-worthy credit and skips the invoice adjustment entirely", async () => {
    const result = await incidentSvc.simulateBreach("slo-1", "inv-1", 99.95, "system:sla-monitor");

    expect(result.creditAmount).toBe("0.0000");
    expect(result.adjustment).toBeNull();
    expect(lineItems).toHaveLength(0); // no adjustment line item written at all

    // An incident record still exists (for audit/history) even at zero credit.
    expect(incidents).toHaveLength(1);
    expect(incidents[0].severity).toBe("MINOR");
  });

  it("a nonexistent SLO definition is refused explicitly", async () => {
    await expect(incidentSvc.simulateBreach("slo-none", "inv-1", 50, "op-1")).rejects.toThrow(/not found/);
  });
});
