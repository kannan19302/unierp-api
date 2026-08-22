import { describe, expect, it, vi } from "vitest";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));
vi.mock("../../common/queues/job-tracking.util", () => ({ enqueueTrackedJob: vi.fn(async () => ({ bullJobId: "42", backgroundJobId: "job-1" })) }));

import { enqueueTrackedJob } from "../../common/queues/job-tracking.util";
import { DeveloperBuildsService } from "./developer-builds.service";

describe("DeveloperBuildsService", () => {
  it("submits a tenant-scoped durable build through the shared tracked queue", async () => {
    const queue = { name: "developer-build" } as any;
    const service = new DeveloperBuildsService(queue);
    await expect(service.enqueue({ tenantId: "tenant-1", projectId: "project-1", startedBy: "user-1" })).resolves.toEqual({ bullJobId: "42", backgroundJobId: "job-1" });
    expect(enqueueTrackedJob).toHaveBeenCalledWith(queue, expect.objectContaining({ tenantId: "tenant-1", jobType: "validate-project-composition", priority: 5, payload: expect.objectContaining({ projectId: "project-1", startedBy: "user-1" }) }));
  });

  it("lists only build jobs scoped to the requested tenant and project", async () => {
    const service = new DeveloperBuildsService({} as any);
    const findMany = vi.fn(async () => []);
    (service as any).db = { backgroundJob: { findMany } };
    await service.list("tenant-1", "project-1");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-1", queueName: "developer-build", payload: { path: ["projectId"], equals: "project-1" } }) }));
  });
});
