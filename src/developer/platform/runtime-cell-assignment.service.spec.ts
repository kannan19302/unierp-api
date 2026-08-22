import { describe, expect, it, vi } from "vitest";
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
import { RuntimeCellAssignmentService } from "./runtime-cell-assignment.service";

describe("RuntimeCellAssignmentService", () => {
  it("persists the deterministic bootstrap placement once per tenant", async () => {
    const create = vi.fn(async ({ data }: any) => ({ ...data }));
    const router = { place: vi.fn(() => ({ cellId: "ap-south-cell-03", shard: 3, region: "ap-south", topologyVersion: "v1" })) };
    const service = new RuntimeCellAssignmentService(router as any);
    (service as any).db = { runtimeCellAssignment: { findFirst: vi.fn(async () => null), create } };
    await expect(service.placement("tenant-1")).resolves.toEqual({ cellId: "ap-south-cell-03", shard: 3, region: "ap-south", topologyVersion: "v1" });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: "tenant-1", cellId: "ap-south-cell-03" }) });
  });

  it("uses the assignment created by a competing API worker after a unique race", async () => {
    const router = { place: vi.fn(() => ({ cellId: "default-cell-01", shard: 1, region: "default", topologyVersion: "v1" })) };
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ cellId: "eu-cell-09", shard: 9, region: "eu", topologyVersion: "v2" });
    const service = new RuntimeCellAssignmentService(router as any);
    (service as any).db = { runtimeCellAssignment: { findFirst, create: vi.fn(async () => { throw new Error("unique constraint"); }) } };
    await expect(service.placement("tenant-1")).resolves.toEqual({ cellId: "eu-cell-09", shard: 9, region: "eu", topologyVersion: "v2" });
  });

  it("relocates only through an explicit assignment update", async () => {
    const update = vi.fn(async ({ data }: any) => ({ cellId: data.cellId, shard: data.shard, region: data.region, topologyVersion: data.topologyVersion }));
    const service = new RuntimeCellAssignmentService({ place: vi.fn() } as any);
    (service as any).db = { runtimeCellAssignment: { findFirst: vi.fn(async () => ({ id: "assignment-1", cellId: "old", shard: 1, region: "old", topologyVersion: "v1" })), update }, runtimeCellAssignmentEvent: { create: vi.fn(async () => ({})) } };
    await expect(service.relocate("tenant-1", { cellId: "new", shard: 7, region: "ap-south", topologyVersion: "v2" })).resolves.toMatchObject({ cellId: "new", shard: 7 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "assignment-1" }, data: expect.objectContaining({ relocationCount: { increment: 1 } }) }));
  });
});
