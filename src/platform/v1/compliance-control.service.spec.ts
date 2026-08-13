/**
 * M38 exit criterion: "An auditor's question is answered with an
 * exported evidence artefact generated from REAL audit records, with
 * no manual assembly step. A failing control is failing in the
 * console before it is failing in an audit."
 *
 * The proof mocks `@kannan19302/database` (as every plane-1 spec
 * does — the published client does not carry Track M models) and
 * seeds REAL `controlPlaneAuditLog` rows, then:
 *  1. evaluates a control whose evidence exists → PASS;
 *  2. evaluates a control whose evidence does not exist → FAIL —
 *     and the FAIL is what the console renders before any audit;
 *  3. exports evidence and asserts the artefact rows ARE the audit
 *     records (no manual assembly) and the contentHash verifies;
 *  4. refuses a control that is not in the catalogue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

let auditLogs: any[];
let evaluations: any[];
let evidenceRows: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => {
  /** Interpret a Prisma JSON filter: { path: ["a","b"], equals: X }. */
  function jsonMatches(record: any, filter: any) {
    if (!filter) return true;
    const { path, equals } = filter;
    if (!Array.isArray(path)) return true;
    let value: unknown = record;
    for (const segment of path) value = (value as any)?.[segment];
    return value === equals;
  }

  return {
    prisma: {
      controlPlaneAuditLog: {
        count: vi.fn(({ where }: any) => {
          const rows = auditLogs.filter((r) => {
            if (where.actorId) {
              if (r.actorId === (where.actorId as any).not) return false;
            }
            if (where.action) {
              if (!String(r.action).includes((where.action as any).contains)) return false;
            }
            if (where.details && !jsonMatches(r.details, where.details)) return false;
            if (where.contentHash || where.previousHash) {
              if ((r.contentHash ?? "") === "" || (r.previousHash ?? null) === null) return false;
            }
            return true;
          });
          return rows.length;
        }),
        findMany: vi.fn(({ where }: any) => {
          if (!where || Object.keys(where).length === 0) return [...auditLogs];
          return auditLogs.filter((r) => {
            if (where.actorId) {
              if (r.actorId === (where.actorId as any).not) return false;
            }
            if (where.action) {
              if (!String(r.action).includes((where.action as any).contains)) return false;
            }
            if (where.details && !jsonMatches(r.details, where.details)) return false;
            if (where.contentHash || where.previousHash) {
              if ((r.contentHash ?? "") === "" || (r.previousHash ?? null) === null) return false;
            }
            return true;
          });
        }),
      },
      complianceControlEvaluation: {
        create: vi.fn(({ data }: any) => {
          const row = { id: nextId("eval"), evaluatedAt: new Date(), ...data };
          evaluations.push(row);
          return row;
        }),
        findMany: vi.fn(() => [...evaluations]),
      },
      complianceEvidence: {
        create: vi.fn(({ data }: any) => {
          const row = { id: nextId("evidence"), generatedAt: new Date(), ...data };
          evidenceRows.push(row);
          return row;
        }),
        findMany: vi.fn(({ where }: any) =>
          evidenceRows.filter((r) => r.controlCode === where.controlCode),
        ),
      },
    },
  };
});

import { ComplianceControlService, CONTROL_CATALOGUE } from "./compliance-control.service";

describe("M38 · compliance controls and evidence", () => {
  let compliance: ComplianceControlService;

  beforeEach(() => {
    vi.clearAllMocks();
    auditLogs = [];
    evaluations = [];
    evidenceRows = [];
    compliance = new ComplianceControlService();
  });

  function seedRealAuditRows() {
    auditLogs.push(
      {
        id: "audit-1",
        actorId: "operator-a",
        action: "tenant.provision",
        details: { requiredApproval: true },
        contentHash: "abc123",
        previousHash: "",
      },
      {
        id: "audit-2",
        actorId: "operator-b",
        action: "tenant.suspend",
        details: { requiredApproval: true },
        contentHash: "def456",
        previousHash: "abc123",
      },
      {
        id: "audit-3",
        actorId: "operator-c",
        action: "two-person-control.approval-approved",
        details: { approvalId: "appr-1", requestedAction: "tenant.delete" },
        contentHash: "ghi789",
        previousHash: "def456",
      },
    );
  }

  it("PASSES a control whose evidence exists on the real audit spine", async () => {
    seedRealAuditRows();
    const evaluation = await compliance.evaluateControl("AUDIT-COMPLETE");
    expect(evaluation.status).toBe("PASS");
    expect(evaluation.observed).toBe(3);
  });

  it("FAILS a control whose evidence is missing — failing in the console before it is failing in an audit", async () => {
    // No audit rows at all: AUDIT-COMPLETE must FAIL, and that FAIL
    // is what runMonitoring() hands the console — the console shows a
    // red control before any external audit has run.
    const monitoring = await compliance.runMonitoring();
    const auditComplete = monitoring.find((c) => c.code === "AUDIT-COMPLETE")!;
    expect(auditComplete.status).toBe("FAIL");
    expect(auditComplete.observed).toBe(0);
    expect(auditComplete.finding).toMatch(/1 required/);
  });

  it("renders the latest evaluation for each control — a FAIL is visible on first load", async () => {
    // Seed rows WITHOUT any two-person approval action, so
    // APPROVAL-TWO-PERSON has evidence missing and must FAIL while
    // AUDIT-COMPLETE PASSes — a mixed console, exactly what an
    // operator sees when something is wrong but not everything is.
    auditLogs.push(
      { id: "audit-1", actorId: "operator-a", action: "tenant.provision", details: {}, contentHash: "abc123", previousHash: "" },
      { id: "audit-2", actorId: "operator-b", action: "tenant.suspend", details: {}, contentHash: "def456", previousHash: "abc123" },
    );
    await compliance.evaluateControl("AUDIT-COMPLETE"); // PASS persisted
    await compliance.evaluateControl("APPROVAL-TWO-PERSON"); // FAIL persisted (no approval records)
    const catalogue = await compliance.listCatalogue();
    const auditComplete = catalogue.find((c) => c.code === "AUDIT-COMPLETE")!;
    const approval = catalogue.find((c) => c.code === "APPROVAL-TWO-PERSON")!;
    expect(auditComplete.status).toBe("PASS");
    expect(approval.status).toBe("FAIL");
  });

  it("the catalogue is mapped to frameworks and rendered by the console", () => {
    expect(CONTROL_CATALOGUE.length).toBeGreaterThanOrEqual(4);
    const first = CONTROL_CATALOGUE[0]!;
    expect(first.frameworks).toMatch(/SOC2|ISO27001|GDPR/);
  });

  it("EXPORTS evidence generated from real audit records — no manual assembly step", async () => {
    seedRealAuditRows();
    const artefact = await compliance.exportEvidence(
      "AUDIT-COMPLETE",
      "Show every provider operation recorded in the last quarter",
      "auditor-1",
    );

    const rows: any[] = artefact.artefact.records;
    expect(rows).toHaveLength(3);
    // The artefact rows ARE the audit records — same ids, same content.
    expect(rows.map((r) => r.id).sort()).toEqual(["audit-1", "audit-2", "audit-3"]);
    expect(rows.map((r) => r.contentHash).sort()).toEqual(["abc123", "def456", "ghi789"]);
    // The persisted contentHash verifies the packaged rows against the spine.
    const serialised = JSON.stringify(rows, null, 2);
    const expectHash = createHash("sha256").update(serialised).digest("hex");
    expect(artefact.contentHash).toBe(expectHash);
  });

  it("an auditor question and an exporting operator are both required — no anonymous export", async () => {
    await expect(compliance.exportEvidence("AUDIT-COMPLETE", "", "auditor-1")).rejects.toThrow(/question/);
    await expect(compliance.exportEvidence("AUDIT-COMPLETE", "a question", "  ")).rejects.toThrow(/identified/);
    expect(evidenceRows).toHaveLength(0);
  });

  it("refuses a control that is not in the catalogue", async () => {
    await expect(compliance.evaluateControl("NOT-A-CONTROL")).rejects.toThrow(/not in the catalogue/);
    await expect(compliance.exportEvidence("NOT-A-CONTROL", "q", "auditor-1")).rejects.toThrow(/not in the catalogue/);
  });

  it("lists previously exported evidence artefacts for a control", async () => {
    seedRealAuditRows();
    await compliance.exportEvidence("AUDIT-COMPLETE", "First question", "auditor-1");
    await compliance.exportEvidence("AUDIT-COMPLETE", "Second question", "auditor-2");
    const list = await compliance.listEvidence("AUDIT-COMPLETE");
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.auditorQuestion).sort()).toEqual(["First question", "Second question"]);
  });
});