import { describe, expect, it, vi } from "vitest";
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
vi.mock("../../common/queues/job-tracking.util", () => ({ enqueueTrackedJob: vi.fn(async () => ({ backgroundJobId: "job-1", bullJobId: "bull-1" })) }));
import { ProjectPreviewService } from "./project-preview.service";
describe("ProjectPreviewService", () => {
  it("stores only a hash of a short-lived preview token", async () => {
    const create = vi.fn(async ({ data }: any) => ({ id: "preview-1", context: data.context })); const audit = vi.fn(async () => undefined);
    const previewSession = { count: vi.fn(async () => 0), create }; const service = new ProjectPreviewService({ currentComposition: vi.fn(async () => ({ fingerprint: "fp" })) } as any, {} as any); (service as any).db = { $transaction: (callback: any) => callback({ $executeRawUnsafe: vi.fn(), projectPreviewSession: previewSession }), projectPreviewSession: previewSession, developerAuditEvent: { create: audit } };
    const result = await service.create({ tenantId: "tenant-1", projectId: "project-1" });
    expect(result.token).toBeTruthy(); expect(result.status).toBe("PENDING"); expect(result.governor).toMatchObject({ activeSessions: 1, hardLimit: 20, level: "PASS" }); expect(create.mock.calls[0][0].data.tokenHash).not.toBe(result.token); expect(create.mock.calls[0][0].data.sourceFingerprint).toBe("fp"); expect(create.mock.calls[0][0].data.status).toBe("PENDING");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "PREVIEW_REQUESTED", metadata: expect.not.objectContaining({ token: expect.anything() }) }) }));
  });
  it("refuses a preview whose draft composition changed after session creation", async () => {
    const service = new ProjectPreviewService({ currentComposition: vi.fn(async () => ({ fingerprint: "new", artifacts: [], packages: [] })) } as any, {} as any);
    (service as any).db = { projectPreviewSession: { findFirst: vi.fn(async () => ({ projectId: "project-1", sourceFingerprint: "old", context: {} })) } };
    await expect(service.resolve("tenant-1", "token")).rejects.toThrow(/stale/);
  });
  it("does not issue a preview for a composition containing a suspended package", async () => {
    const service = new ProjectPreviewService({ currentComposition: vi.fn(async () => ({ fingerprint: "fp", invalidPackages: ["com.acme.bad@1.0.0"] })) } as any, {} as any);
    (service as any).db = { projectPreviewSession: { create: vi.fn() } };
    await expect(service.create({ tenantId: "tenant-1", projectId: "project-1" })).rejects.toThrow(/suspended or invalid/);
  });
  it("uses the tenant preview-session hard limit before admitting work", async () => {
    const service = new ProjectPreviewService({ currentComposition: vi.fn(async () => ({ fingerprint: "fp" })) } as any, {} as any, { limits: vi.fn(async () => ({ previewSessions: { soft: 1, hard: 2 } })) } as any);
    const previewSession = { count: vi.fn(async () => 2), create: vi.fn() }; (service as any).db = { $transaction: (callback: any) => callback({ $executeRawUnsafe: vi.fn(), projectPreviewSession: previewSession }), projectPreviewSession: previewSession };
    await expect(service.create({ tenantId: "tenant-1", projectId: "project-1" })).rejects.toThrow(/limit reached/);
  });
  it("activates a pending preview only after rechecking its pinned composition", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const metering = { record: vi.fn(async () => undefined) }; const service = new ProjectPreviewService({ currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [], packages: [] })) } as any, {} as any, undefined, metering as any);
    (service as any).db = { projectPreviewSession: { findFirst: vi.fn(async () => ({ id: "preview-1", projectId: "project-1", sourceFingerprint: "fp", status: "PENDING", expiresAt: new Date(Date.now() + 60_000), revokedAt: null })), updateMany } };
    await expect(service.prepare("tenant-1", "preview-1")).resolves.toMatchObject({ id: "preview-1", status: "ACTIVE" });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "preview-1", status: "PENDING" }, data: { status: "ACTIVE" } }));
    expect(metering.record).toHaveBeenCalledWith({ tenantId: "tenant-1", metric: "DEVELOPER_PREVIEW_SESSION", workloadId: "preview-1", projectId: "project-1" });
  });
  it("submits only through an active, fingerprint-pinned preview", async () => {
    const submissions = { submit: vi.fn(async () => ({ id: "record-1" })) };
    const releases = { currentComposition: vi.fn(async () => ({ fingerprint: "fp", artifacts: [{ artifactId: "form-1", artifactType: "FORM", source: {} }], packages: [] })) };
    const service = new ProjectPreviewService(releases as any, {} as any, undefined, undefined, submissions as any);
    (service as any).db = { projectPreviewSession: { findFirst: vi.fn(async () => ({ id: "preview-1", projectId: "project-1", sourceFingerprint: "fp" })) } };
    await expect(service.submit("tenant-1", "token", { formArtifactId: "form-1", values: { name: "A" }, createdBy: "user-1" })).resolves.toEqual({ id: "record-1" });
    expect(submissions.submit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", formArtifactId: "form-1", createdBy: "user-1" }));
  });
});
