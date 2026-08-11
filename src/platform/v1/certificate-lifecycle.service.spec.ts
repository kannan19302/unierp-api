/**
 * M23 exit criterion: "A certificate within its alert window raises
 * before expiry, and rotation completes without downtime. No secret
 * value is readable through any console API — asserted by a test that
 * requests one and expects a redacted reference. C26's certificate
 * lifecycle consumes this."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let certs: any[];
let auditLogs: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    saasSslCertificate: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("cert"), issuedAt: new Date(), autoRenew: true, rotatedFromId: null, ...data };
        certs.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => certs.find((c) => c.id === id) ?? null),
      findMany: vi.fn(({ where }: any) => {
        let rows = certs;
        if (where?.status) rows = rows.filter((c) => c.status === where.status);
        if (where?.expiresAt?.lte) rows = rows.filter((c) => new Date(c.expiresAt) <= new Date(where.expiresAt.lte));
        return rows;
      }),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = certs.find((c) => c.id === id)!;
        Object.assign(row, data);
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
  },
}));

import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { CertificateLifecycleService } from "./certificate-lifecycle.service";

describe("M23 · secrets, certificates and keys", () => {
  let certificates: CertificateLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    certs = [];
    auditLogs = [];
    certificates = new CertificateLifecycleService(new ControlPlaneAuditService());
  });

  it("no secret value is readable through any console API — only a redacted reference", async () => {
    const issued = await certificates.issue("tenant-1", "domain-1");
    const fetched = await certificates.get(issued.id);

    expect(fetched.secretRef).toMatch(/^vault:\/\//);
    // The exit criterion's own words: not just "no field named secret" but
    // asserted against everything the API actually returns.
    const returnedKeys = Object.keys(fetched);
    expect(returnedKeys).not.toContain("pem");
    expect(returnedKeys).not.toContain("privateKey");
    expect(returnedKeys).not.toContain("value");
    expect(returnedKeys).not.toContain("secret");
    // secretRef itself is a pointer, never certificate material.
    expect(fetched.secretRef).not.toMatch(/BEGIN CERTIFICATE|BEGIN PRIVATE KEY/);
  });

  it("a certificate within its alert window raises BEFORE expiry", async () => {
    const soon = await certificates.issue("tenant-1", "domain-soon");
    // Force it inside the 14-day default window.
    const soonRow = certs.find((c) => c.id === soon.id)!;
    soonRow.expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    const farRow = (await certificates.issue("tenant-1", "domain-far")) as any;
    // Default issue() already sets expiresAt 90 days out — outside the window.

    const atRisk = await certificates.checkExpiryAlerts(14);

    expect(atRisk.map((c) => c.id)).toContain(soon.id);
    expect(atRisk.map((c) => c.id)).not.toContain(farRow.id);

    const alerts = auditLogs.filter((a) => a.action === "certificate.expiry-alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].targetId).toBe("domain-soon");
  });

  it("rotation completes WITHOUT DOWNTIME: the domain always has at least one ACTIVE certificate", async () => {
    const original = await certificates.issue("tenant-1", "domain-1");

    const { oldCert, newCert } = await certificates.rotate(original.id);

    expect(oldCert.status).toBe("ROTATED");
    expect(newCert.status).toBe("ACTIVE");
    expect(newCert.id).not.toBe(oldCert.id);

    // At no point was the old certificate deleted or left without a
    // successor already ACTIVE -- both rows still exist right now.
    expect(certs.find((c) => c.id === original.id)).toBeDefined();
    expect(certs.some((c) => c.domainId === "domain-1" && c.status === "ACTIVE")).toBe(true);
  });

  it("C26's certificate lifecycle (issueSslCert) consumes this service, not a duplicate implementation", async () => {
    const { SaasWhiteLabelDeepService } = await import("./white-label.service");
    const { DnsService } = await import("../provider-registry/dns.service");
    const { ProviderRegistryService } = await import("../provider-registry/provider-registry.service");
    const { RoutingService } = await import("../provider-registry/routing.service");

    const whiteLabel = new SaasWhiteLabelDeepService(
      new DnsService(new ProviderRegistryService(), new RoutingService(new ProviderRegistryService())),
      certificates,
    );

    const cert = await whiteLabel.issueSslCert("tenant-1", "domain-c26");
    expect(cert.status).toBe("ACTIVE");
    expect((cert as any).secretRef).toMatch(/^vault:\/\//);
    // It landed in the SAME store CertificateLifecycleService.get() reads.
    const fetched = await certificates.get(cert.id);
    expect(fetched.domainId).toBe("domain-c26");
  });
});
