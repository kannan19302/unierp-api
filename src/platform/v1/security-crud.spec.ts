import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPolicies: any[] = [];
const mockCertificates: any[] = [
  {
    id: "cert-alpha",
    domainId: "api.acme.example.com",
    tenantId: "tenant-acme",
    provider: "LETS_ENCRYPT",
    status: "ACTIVE",
    secretRef: "vault://certs/cert-alpha",
    issuedAt: new Date("2026-01-01"),
    expiresAt: new Date("2026-12-31"),
  },
];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    $transaction: vi.fn(async (callback: any) => {
      return callback({
        loginHistory: { updateMany: vi.fn().mockResolvedValue({ count: 4 }) },
        tenant: { update: vi.fn().mockResolvedValue({ id: "tenant-acme", status: "SUSPENDED" }) },
        systemAnnouncement: { create: vi.fn().mockResolvedValue({ id: "ann-1" }) },
      });
    }),
    policy: {
      findMany: vi.fn(async ({ skip = 0, take = 20 }: any) => mockPolicies.slice(skip, skip + take)),
      count: vi.fn(async () => mockPolicies.length),
      findUnique: vi.fn(async ({ where }: any) => mockPolicies.find((p) => p.id === where.id)),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `pol-${Date.now()}`, ...data, createdAt: new Date() };
        mockPolicies.push(item);
        return item;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const item = mockPolicies.find((p) => p.id === where.id);
        if (item) Object.assign(item, data);
        return item;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const idx = mockPolicies.findIndex((p) => p.id === where.id);
        if (idx >= 0) mockPolicies.splice(idx, 1);
        return { id: where.id };
      }),
    },
    saasSslCertificate: {
      findUnique: vi.fn(async ({ where }: any) => mockCertificates.find((c) => c.id === where.id)),
      update: vi.fn(async ({ where, data }: any) => {
        const cert = mockCertificates.find((c) => c.id === where.id);
        if (cert) Object.assign(cert, data);
        return cert;
      }),
    },
  },
}));

vi.mock("./control-plane-audit.service", () => ({
  ControlPlaneAuditService: vi.fn().mockImplementation(() => ({
    record: vi.fn().mockResolvedValue(true),
  })),
}));

import { SecurityOperationsService } from "./security-operations.service";
import { CertificateLifecycleService } from "./certificate-lifecycle.service";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

describe("Security Operations & Policy Services", () => {
  let socService: SecurityOperationsService;
  let certService: CertificateLifecycleService;
  let audit: ControlPlaneAuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    audit = new ControlPlaneAuditService({} as any);
    socService = new SecurityOperationsService(audit);
    certService = new CertificateLifecycleService(audit);
  });

  it("lists security policies with pagination and creates a new policy", async () => {
    const listRes = await socService.listPolicies();
    expect(listRes.data.length).toBeGreaterThan(0);

    const created = await socService.createPolicy(
      {
        name: "Custom Data Perimeter Invariant",
        description: "Enforces VPC peering requirements for private tenant clusters",
        scopeType: "PLATFORM",
        isolationLevel: "CELL_ISOLATED",
        enforcementMode: "BLOCK",
        reason: "Compliance mandate",
      },
      "super-admin-user"
    );

    expect(created).toBeDefined();
    expect(created.name).toBe("Custom Data Perimeter Invariant");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "soc.policy.create",
      })
    );
  });

  it("lists threat events and triages through operational stages", async () => {
    const threats = socService.listThreats({ severity: "CRITICAL" });
    expect(threats.data.length).toBeGreaterThan(0);
    const critical = threats.data[0];
    expect(critical.severity).toBe("CRITICAL");

    const triaged = await socService.triageThreat(
      critical.id,
      {
        action: "RESOLVE",
        notes: "Perimeter rule updated to drop rogue subnet probe packets.",
        assignedTo: "sec-lead",
      },
      "operator-1"
    );

    expect(triaged.status).toBe("RESOLVED");
    expect(triaged.triageHistory.length).toBeGreaterThan(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "soc.threat.resolve",
      })
    );
  });

  it("revokes and retires a certificate with audit record", async () => {
    const revoked = await certService.revoke("cert-alpha", "Key compromise drill", "admin-1");
    expect(revoked.status).toBe("REVOKED");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "certificate.revoked",
        targetId: "api.acme.example.com",
      })
    );
  });
});
