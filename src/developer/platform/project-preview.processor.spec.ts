import { describe, expect, it, vi } from "vitest";
import { ProjectPreviewProcessor } from "./project-preview.processor";

describe("ProjectPreviewProcessor", () => {
  it("activates the session through the durable worker boundary", async () => {
    const previews = { prepare: vi.fn(async () => ({ id: "preview-1", projectId: "project-1", status: "ACTIVE" })), failPreparation: vi.fn() };
    const worker = new ProjectPreviewProcessor(previews as any);
    const updateProgress = vi.fn(async () => undefined);
    await expect(worker.process({ data: { tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", requestedAt: "now" }, updateProgress } as any)).resolves.toEqual({ previewId: "preview-1", projectId: "project-1", status: "ACTIVE" });
    expect(updateProgress).toHaveBeenNthCalledWith(1, 15);
    expect(updateProgress).toHaveBeenNthCalledWith(2, 100);
  });
  it("marks a pending preview failed when preparation cannot complete", async () => {
    const previews = { prepare: vi.fn(async () => { throw new Error("sandbox unavailable"); }), failPreparation: vi.fn(async () => undefined) };
    const worker = new ProjectPreviewProcessor(previews as any);
    await expect(worker.process({ data: { tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", requestedAt: "now" }, updateProgress: vi.fn() } as any)).rejects.toThrow("sandbox unavailable");
    expect(previews.failPreparation).toHaveBeenCalledWith("tenant-1", "preview-1");
  });
  it("keeps a preview pending until the last configured retry fails", async () => {
    const previews = { prepare: vi.fn(async () => { throw new Error("temporary failure"); }), failPreparation: vi.fn(async () => undefined) };
    const worker = new ProjectPreviewProcessor(previews as any);
    await expect(worker.process({ data: { tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", requestedAt: "now" }, updateProgress: vi.fn(), opts: { attempts: 3 }, attemptsMade: 0 } as any)).rejects.toThrow("temporary failure");
    expect(previews.failPreparation).not.toHaveBeenCalled();
  });
});
