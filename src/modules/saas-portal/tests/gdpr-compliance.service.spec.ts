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
  idpPrisma: {
    user: {
      findMany: vi.fn(
        ({ where }: any) => users.filter(
          (u) => u.tenantId === where.tenantId && u.email === where.email,
        ).map((u) => ({ id: u.id })),
      ),
      deleteMany: vi.fn(({ where }: any) => {
        const allowed: string[] = where.id?.in || [];
        const before = users.length;
        users = users.filter((u) => !(
          u.tenantId === where.tenantId && u.email === where.email && allowed.includes(u.id)
        ));
        return { count: before - users.length };
      }),
      update: vi.fn(({ where: { id }, data }: any) => {
        const user = users.find((candidate) => candidate.id === id)!;
        Object.assign(user, data);
        return user;
      }),
    },
    userSession: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    userIdentity: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    userRole: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    userGroupMember: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    authApiToken: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    pushSubscription: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    emailVerificationToken: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    passkey: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    accountContact: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    userProfile: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
  runWithTenantSession: vi.fn((_session: unknown, operation: () => unknown) => operation()),
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
      findMany: vi.fn(({ where }: any) => storedFiles
        .filter((file) => file.tenantId === where.tenantId && (where.createdBy.in || [where.createdBy]).includes(file.createdBy))
        .map((file) => ({ id: file.id }))),
      deleteMany: vi.fn(({ where }: any) => {
        const ids: string[] = where.id.in;
        const before = storedFiles.length;
        storedFiles = storedFiles.filter((f) => !(f.tenantId === where.tenantId && ids.includes(f.id)));
        return { count: before - storedFiles.length };
      }),
    },
    document: {
      findMany: vi.fn(({ where }: any) => documents
        .filter((document) => document.tenantId === where.tenantId && (where.createdBy.in || [where.createdBy]).includes(document.createdBy))
        .map((document) => ({ id: document.id }))),
      deleteMany: vi.fn(({ where }: any) => {
        const ids: string[] = where.id.in;
        const before = documents.length;
        documents = documents.filter((d) => !(d.tenantId === where.tenantId && ids.includes(d.id)));
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
    service = new SaasPortalGdprComplianceService(
      new GdprCryptoShredService(),
      { excludeHeld: vi.fn(async (_tenantId: string, _entityType: string, ids: string[]) => ids) } as any,
    );
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

  it("honors the cooling-off deadline before beginning any destructive work", async () => {
    vi.mocked(prisma.dataErasureRequest.findFirst).mockResolvedValue({
      id: "req-future",
      tenantId: "t1",
      status: "PENDING",
      subjectEmail: "erase-me@x.com",
      entityTypes: ["User"],
      eligibleAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(service.executeErasure("t1", "req-future")).rejects.toThrow(/cooling-off/);
    expect(users).toHaveLength(1);
    expect(prisma.dataErasureRequest.update).not.toHaveBeenCalled();
  });

  it("revokes identity authority and anonymizes the retained structural user row", async () => {
    vi.spyOn(service, "loadPiiRegistry").mockReturnValue({
      comment: "test",
      models: {
        User: { treatment: "anonymize", rationale: "retain references", reviewed: "2026-08-24" },
      },
    });
    vi.mocked(prisma.dataErasureRequest.findFirst).mockResolvedValue({
      id: "req-anonymize",
      tenantId: "t1",
      status: "PENDING",
      subjectEmail: "erase-me@x.com",
      entityTypes: ["User"],
      eligibleAt: new Date(Date.now() - 1_000),
      requestedBy: "user-1",
    } as never);

    const result = await service.executeErasure("t1", "req-anonymize");

    expect(result.retainedUnderLegalHold).toBe(false);
    expect(users[0]).toMatchObject({
      status: "ERASED",
      firstName: "[redacted]",
      lastName: "[redacted]",
      passwordHash: null,
      mfaEnabled: false,
    });
    expect(users[0].email).toBe("[redacted-user-1]@erased.local");
    expect(storedFiles.map((file) => file.id)).toEqual(["sf-2"]);
    expect(documents.map((document) => document.id)).toEqual(["doc-2"]);
  });

  it("preserves held identity records and reports a completed-with-retentions outcome", async () => {
    service = new SaasPortalGdprComplianceService(
      new GdprCryptoShredService(),
      { excludeHeld: vi.fn(async (_tenantId: string, entityType: string, ids: string[]) => entityType === "User" ? [] : ids) } as any,
    );
    vi.spyOn(service, "loadPiiRegistry").mockReturnValue({
      comment: "test",
      models: {
        User: { treatment: "anonymize", rationale: "retain references", reviewed: "2026-08-24" },
      },
    });
    vi.mocked(prisma.dataErasureRequest.findFirst).mockResolvedValue({
      id: "req-held",
      tenantId: "t1",
      status: "PENDING",
      subjectEmail: "erase-me@x.com",
      entityTypes: ["User"],
      requestedBy: "user-1",
    } as never);

    const result = await service.executeErasure("t1", "req-held");

    expect(result.retainedUnderLegalHold).toBe(true);
    expect(users[0].email).toBe("erase-me@x.com");
    expect(prisma.dataErasureRequest.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED_WITH_RETENTIONS" }),
    }));
  });
});
