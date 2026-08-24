import { describe, expect, it, vi } from "vitest";

vi.mock("../../../common/services/logger.service", () => ({
  pinoLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { PrivacyOperationsProcessor } from "../services/privacy-operations.processor";

describe("PrivacyOperationsProcessor", () => {
  it("turns atomically claimed requests into independently retryable jobs", async () => {
    const operations = {
      claimEligible: vi.fn().mockResolvedValue([
        { request_id: "request-1", tenant_id: "tenant-1" },
        { request_id: "request-2", tenant_id: "tenant-2" },
      ]),
      purgeExpiredExports: vi.fn().mockResolvedValue([{ job_id: "export-1" }]),
      execute: vi.fn(),
    };
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const processor = new PrivacyOperationsProcessor(operations as any, queue as any);

    const result = await processor.process({ data: { kind: "sweep" } } as any);

    expect(result).toEqual({ claimed: 2, purgedExports: 1 });
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      "erase",
      { kind: "erase", requestId: "request-1", tenantId: "tenant-1" },
      expect.objectContaining({ jobId: "erasure-request-1", attempts: 5 }),
    );
  });

  it("executes one request inside its claimed tenant", async () => {
    const operations = {
      claimEligible: vi.fn(),
      purgeExpiredExports: vi.fn(),
      execute: vi.fn().mockResolvedValue({ results: [] }),
    };
    const processor = new PrivacyOperationsProcessor(operations as any, { add: vi.fn() } as any);

    await processor.process({
      data: { kind: "erase", requestId: "request-1", tenantId: "tenant-1" },
    } as any);

    expect(operations.execute).toHaveBeenCalledWith("request-1", "tenant-1");
  });
});
