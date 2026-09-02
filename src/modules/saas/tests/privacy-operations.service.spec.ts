import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@kannan19302/database", () => ({
  prisma: { $queryRaw: queryRaw },
}));

import { PrivacyOperationsService } from "../services/privacy-operations.service";

describe("PrivacyOperationsService", () => {
  const gdpr = { executeErasure: vi.fn() };
  let service: PrivacyOperationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrivacyOperationsService(gdpr as any);
  });

  it("claims eligible erasures only through the narrow database function", async () => {
    queryRaw.mockResolvedValue([{ request_id: "request-1", tenant_id: "tenant-1" }]);

    const result = await service.claimEligible(10_000);

    expect(result).toEqual([{ request_id: "request-1", tenant_id: "tenant-1" }]);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("re-enters the tenant erasure service for one claimed request", async () => {
    gdpr.executeErasure.mockResolvedValue({ results: [] });

    await service.execute("request-1", "tenant-1");

    expect(gdpr.executeErasure).toHaveBeenCalledWith("tenant-1", "request-1");
  });

  it("purges only expired inline-export records through the bounded function", async () => {
    queryRaw.mockResolvedValue([{ job_id: "export-1", tenant_id: "tenant-1", file_url: null }]);

    const result = await service.purgeExpiredExports(9999);

    expect(result[0].job_id).toBe("export-1");
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});
