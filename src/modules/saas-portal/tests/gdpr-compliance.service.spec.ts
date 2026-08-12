/**
 * E32 exit criterion: "A GDPR erasure removes attachments too. Proven,
 * not assumed."
 *
 * SaasPortalGdprComplianceService.executeErasure() deleted matching
 * User rows but never touched their uploaded StoredFile/Document
 * records — a subject's identity could be erased while their uploaded
 * files (photos, ID scans, signed contracts) survived untouched.
 *
 * Separately, scripts/pii-registry.json (read by loadPiiRegistry(), a
 * hard dependency of executeErasure()) did not exist anywhere in this
 * repository — every erasure request would throw an ENOENT before
 * doing anything at all. Created in this same pass; a spec here would
 * be redundant with the FAIL-first proof (executeErasure() throwing
 * is not specific to the attachment gap), so this file focuses on the
 * attachment-erasure behavior once the registry exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let users: any[];
let storedFiles: any[];
let documents: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    user: {
      findMany: vi.fn(
        ({ where }: any) =>
          users.filter(
            (u) => u.tenantId === where.tenantId && u.email === where.email,
          ).map((u) => ({ id: u.id })),
      ),
      deleteMany: vi.fn(({ where }: any) => {
        const before = users.length;
        users = users.filter(
          (u) => !(u.tenantId === where.tenantId && u.email === where.email),
        );
        return { count: before - users.length };
      }),
    },
    storedFile: {
      deleteMany: vi.fn(({ where }: any) => {
        const ids: string[] = where.createdBy.in;
        const before = storedFiles.length;
        storedFiles = storedFiles.filter(
          (f) => !(f.tenantId === where.tenantId && ids.includes(f.createdBy)),
        );
        return { count: before - storedFiles.length };
      }),
    },
    document: {
      deleteMany: vi.fn(({ where }: any) => {
        const ids: string[] = where.createdBy.in;
        const before = documents.length;
        documents = documents.filter(
          (d) => !(d.tenantId === where.tenantId && ids.includes(d.createdBy)),
        );
        return { count: before - documents.length };
      }),
    },
    dataErasureRequest: {
      findFirst: vi.fn(),
      update: vi.fn((args: any) => args.data),
    },
    subjectErasureKey: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "key-1", encryptionKey: "k" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { SaasPortalGdprComplianceService } from "../services/gdpr-compliance.service";
import { GdprCryptoShredService } from "../services/gdpr-crypto-shred.service";
import { prisma } from "@kannan19302/database";

describe("E32 · SaasPortalGdprComplianceService erasure removes attachments", () => {
  let service: SaasPortalGdprComplianceService;

  beforeEach(() => {
    vi.clearAllMocks();
    users = [{ id: "user-1", tenantId: "t1", email: "erase-me@x.com" }];
    storedFiles = [
      { id: "sf-1", tenantId: "t1", createdBy: "user-1" },
      { id: "sf-2", tenantId: "t1", createdBy: "user-other" },
    ];
    documents = [
      { id: "doc-1", tenantId: "t1", createdBy: "user-1" },
      { id: "doc-2", tenantId: "t1", createdBy: "user-other" },
    ];
    service = new SaasPortalGdprComplianceService(new GdprCryptoShredService());
    vi.spyOn(service, "loadPiiRegistry").mockReturnValue({
      comment: "test",
      models: {
        User: {
          treatment: "erase",
          rationale: "test",
          reviewed: "2026-08-12",
        },
      },
    });
  });

  it("deletes the erased user's StoredFile and Document rows, but leaves other users' files untouched", async () => {
    vi.mocked(prisma.dataErasureRequest.findFirst).mockResolvedValue({
      id: "req-1",
      tenantId: "t1",
      status: "PENDING",
      subjectEmail: "erase-me@x.com",
      entityTypes: ["User"],
    } as never);

    await service.executeErasure("t1", "req-1");

    expect(storedFiles.map((f) => f.id)).toEqual(["sf-2"]);
    expect(documents.map((d) => d.id)).toEqual(["doc-2"]);
  });
});
