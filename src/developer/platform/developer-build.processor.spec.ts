import { describe, expect, it, vi } from "vitest";
vi.mock("../../common/queues/job-tracking.util", () => ({ syncBackgroundJobStatus: vi.fn(async () => undefined) }));
import { DeveloperBuildProcessor } from "./developer-build.processor";

describe("DeveloperBuildProcessor", () => {
  it("runs immutable composition validation in a retryable worker job", async () => {
    const releases = { validate: vi.fn(async () => ({ id: "validation-1", status: "PASSED", score: 100, sourceFingerprint: "fp" })) };
    const metering = { record: vi.fn(async () => undefined) }; const processor = new DeveloperBuildProcessor(releases as any, metering as any);
    const updateProgress = vi.fn(async () => undefined);
    const result = await processor.process({ id: "job-1", data: { tenantId: "tenant-1", projectId: "project-1", startedBy: "user-1", requestedAt: "now" }, updateProgress } as any);
    expect(releases.validate).toHaveBeenCalledWith({ tenantId: "tenant-1", projectId: "project-1", startedBy: "user-1" });
    expect(updateProgress).toHaveBeenNthCalledWith(1, 10);
    expect(updateProgress).toHaveBeenLastCalledWith(100);
    expect(metering.record).toHaveBeenCalledWith({ tenantId: "tenant-1", metric: "DEVELOPER_VALIDATION_BUILD", workloadId: "job-1", projectId: "project-1" });
    expect(result).toMatchObject({ validationId: "validation-1", status: "PASSED" });
  });
});
