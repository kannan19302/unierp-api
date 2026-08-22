import { describe, expect, it, vi } from "vitest";
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
import { DeveloperWorkloadMeteringService } from "./developer-workload-metering.service";

describe("DeveloperWorkloadMeteringService", () => {
  it("records one idempotent preview event and updates the shared usage snapshot", async () => {
    const findUnique = vi.fn(async () => null); const create = vi.fn(async ({ data }: any) => ({ id: "event-1", ...data })); const upsert = vi.fn(async () => undefined);
    const service = new DeveloperWorkloadMeteringService();
    (service as any).db = { $transaction: (callback: any) => callback({ meteringEvent: { findUnique, create }, usageRecord: { upsert } }) };
    await expect(service.record({ tenantId: "tenant-1", metric: "DEVELOPER_PREVIEW_SESSION", workloadId: "preview-1", projectId: "project-1" })).resolves.toMatchObject({ metric: "DEVELOPER_PREVIEW_SESSION", quantity: 1 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ idempotencyKey: "developer-workload/v1:DEVELOPER_PREVIEW_SESSION:preview-1", source: "developer-platform:project-1" }) }));
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("returns only developer workload usage for the requesting tenant", async () => {
    const findMany = vi.fn().mockResolvedValue([{ metric: "DEVELOPER_PREVIEW_SESSION", currentValue: 2 }]);
    const service = new DeveloperWorkloadMeteringService();
    (service as any).db = { usageRecord: { findMany } };
    await expect(service.usage("tenant-a")).resolves.toEqual([{ metric: "DEVELOPER_PREVIEW_SESSION", currentValue: 2 }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a", metric: { in: ["DEVELOPER_PREVIEW_SESSION", "DEVELOPER_VALIDATION_BUILD"] } }) }));
  });

  it("does not double count a retried workload", async () => {
    const existing = { id: "event-1", metric: "DEVELOPER_VALIDATION_BUILD" }; const create = vi.fn();
    const service = new DeveloperWorkloadMeteringService();
    (service as any).db = { $transaction: (callback: any) => callback({ meteringEvent: { findUnique: vi.fn(async () => existing), create }, usageRecord: { upsert: vi.fn() } }) };
    await expect(service.record({ tenantId: "tenant-1", metric: "DEVELOPER_VALIDATION_BUILD", workloadId: "job-1", projectId: "project-1" })).resolves.toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });
});
