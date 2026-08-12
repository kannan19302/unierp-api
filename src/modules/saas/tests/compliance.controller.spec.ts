/**
 * K04 exit criterion: "An auditor's evidence request is satisfiable
 * from generated artefacts. Nothing is assembled by hand the week
 * before."
 *
 * ComplianceController's read endpoints (listCertifications,
 * listComplianceStandards, getHipaaStatus, getGdprStatus) previously
 * returned hardcoded literals claiming "SOC 2 Type II: certified,"
 * "HIPAA compliant: true, controls: 120, passed: 118," and fake
 * dataExports/erasureRequests counts — identical for every tenant,
 * regardless of reality. This is the server-side, authenticated
 * version of the same fabricated-certification defect K03 (D118)
 * already found and removed from the public marketing site.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let exportJobs: any[];
let erasureRequests: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    dataExportJob: {
      count: vi.fn(({ where }: any) =>
        exportJobs.filter((j) => j.tenantId === where.tenantId).length,
      ),
    },
    dataErasureRequest: {
      count: vi.fn(({ where }: any) =>
        Promise.resolve(
          erasureRequests.filter((r) => r.tenantId === where.tenantId).length,
        ),
      ),
    },
  },
}));

import { ComplianceController } from "../compliance.controller";

describe("K04 · ComplianceController's evidence endpoints reflect real state, not hardcoded certification claims", () => {
  let controller: ComplianceController;
  const req = { user: { tenantId: "t1", userId: "u1", email: "a@b.com", roles: [] } } as any;

  beforeEach(() => {
    exportJobs = [{ tenantId: "t1" }, { tenantId: "t1" }, { tenantId: "t2" }];
    erasureRequests = [{ tenantId: "t1" }];
    controller = new ComplianceController({} as any, {} as any);
  });

  it("listCertifications: no third-party certification is claimed (this platform holds none)", async () => {
    const result = await controller.listCertifications(req);
    for (const cert of result) {
      expect(cert.status).toBe("not_certified");
      expect(cert.certifiedAt).toBeNull();
    }
  });

  it("listComplianceStandards: does not claim SOC 2 is certified", async () => {
    const result = await controller.listComplianceStandards(req);
    const soc2 = result.find((s) => s.id === "soc2");
    expect(soc2?.status).not.toBe("certified");
  });

  it("getHipaaStatus: does not claim HIPAA compliance or fabricate a control count", async () => {
    const result = await controller.getHipaaStatus(req);
    expect(result.compliant).toBe(false);
    expect(result.controls).toBe(0);
    expect(result.passed).toBe(0);
  });

  it("getGdprStatus: dataExports/erasureRequests reflect the REAL tenant-scoped count, not a hardcoded number", async () => {
    const result = await controller.getGdprStatus(req);
    expect(result.dataExports).toBe(2); // only t1's 2 jobs, not t2's
    expect(result.erasureRequests).toBe(1);
  });
});
