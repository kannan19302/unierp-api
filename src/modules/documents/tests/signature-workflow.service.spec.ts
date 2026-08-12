/**
 * E31 exit criterion: "A signed document's integrity is verifiable
 * after the fact, and the trail is admissible."
 *
 * SignatureWorkflowService previously marked a document's
 * signatureStatus "COMPLETED" with no tamper-evident record of what was
 * actually signed — nothing captured the state of the signatures at
 * completion time, so there was no way to later prove the recorded
 * signatures hadn't been altered since. This spec proves the new
 * completion-certificate hash: computed once at completion, verifiable
 * on demand, and sensitive to any later tampering with a signature row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter2 } from "@nestjs/event-emitter";

let signatures: any[];
let auditLogs: any[];
let documents: Record<string, any>;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    document: {
      findFirst: vi.fn((args: any) => documents[args.where.id] ?? null),
      update: vi.fn(({ where, data }: any) => {
        documents[where.id] = { ...documents[where.id], ...data };
        return documents[where.id];
      }),
    },
    signature: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `sig-${signatures.length + 1}`, ...data };
        signatures.push(row);
        return row;
      }),
      findFirst: vi.fn(({ where }: any) =>
        signatures.find((s) => s.id === where.id) ?? null,
      ),
      findMany: vi.fn(({ where }: any) =>
        signatures.filter(
          (s) =>
            s.tenantId === where.tenantId &&
            (!where.documentId || s.documentId === where.documentId) &&
            (!where.status || s.status === where.status),
        ),
      ),
      count: vi.fn(
        ({ where }: any) =>
          signatures.filter(
            (s) =>
              s.tenantId === where.tenantId &&
              s.documentId === where.documentId &&
              s.status === where.status,
          ).length,
      ),
      update: vi.fn(({ where, data }: any) => {
        const sig = signatures.find((s) => s.id === where.id);
        Object.assign(sig, data);
        return sig;
      }),
    },
    documentAuditLog: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `al-${auditLogs.length + 1}`, createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      }),
      findFirst: vi.fn(({ where }: any) => {
        const matches = auditLogs
          .filter(
            (a) =>
              a.tenantId === where.tenantId &&
              a.documentId === where.documentId &&
              a.action === where.action,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return matches[0] ?? null;
      }),
    },
  },
}));

import { SignatureWorkflowService } from "../services/signature-workflow.service";

describe("E31 · SignatureWorkflowService tamper-evident completion certificate", () => {
  let service: SignatureWorkflowService;

  beforeEach(() => {
    vi.clearAllMocks();
    signatures = [];
    auditLogs = [];
    documents = {
      "doc-1": { id: "doc-1", tenantId: "t1", name: "Contract", signatureStatus: "PENDING" },
    };
    service = new SignatureWorkflowService(new EventEmitter2());
  });

  it("verifyDocumentIntegrity returns verified: true immediately after all signatures complete", async () => {
    signatures.push({
      id: "sig-1",
      tenantId: "t1",
      documentId: "doc-1",
      signerEmail: "a@x.com",
      status: "PENDING",
      signedAt: null,
      ipAddress: null,
      signatureData: null,
    });

    await service.signDocument("t1", "sig-1", "base64-signature-blob", "1.2.3.4");

    const result = await service.verifyDocumentIntegrity("t1", "doc-1");
    expect(result.verified).toBe(true);
    expect(result.certifiedHash).toBe(result.currentHash);
  });

  it("verifyDocumentIntegrity returns verified: false when a signature row is tampered with after completion", async () => {
    signatures.push({
      id: "sig-1",
      tenantId: "t1",
      documentId: "doc-1",
      signerEmail: "a@x.com",
      status: "PENDING",
      signedAt: null,
      ipAddress: null,
      signatureData: null,
    });

    await service.signDocument("t1", "sig-1", "base64-signature-blob", "1.2.3.4");

    // Simulate tampering: the signature row is altered directly in the
    // database after the completion certificate was issued.
    signatures[0].signatureData = "forged-signature-blob";

    const result = await service.verifyDocumentIntegrity("t1", "doc-1");
    expect(result.verified).toBe(false);
    expect(result.currentHash).not.toBe(result.certifiedHash);
  });

  it("verifyDocumentIntegrity throws when no completion certificate exists (document never fully signed)", async () => {
    await expect(
      service.verifyDocumentIntegrity("t1", "doc-1"),
    ).rejects.toThrow(/no completion certificate/i);
  });
});
