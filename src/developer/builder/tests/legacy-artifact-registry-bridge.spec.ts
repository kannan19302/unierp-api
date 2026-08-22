import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@kannan19302/database";
import { BuilderFormsService } from "../builder-forms.service";
import { BuilderWorkflowsService } from "../builder-workflows.service";
import { BuilderDashboardsService } from "../builder-dashboards.service";

vi.mock("@kannan19302/database", () => ({ prisma: { builderForm: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }, builderWorkflow: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }, builderDashboard: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } } }));

describe("legacy artifact registry bridge", () => {
  const artifacts = { record: vi.fn(), retire: vi.fn() };
  beforeEach(() => vi.clearAllMocks());

  it("mirrors form create and deletion to a Library artifact identity", async () => {
    const service = new BuilderFormsService(artifacts as any);
    (prisma.builderForm.findFirst as any).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "form-1", tenantId: "tenant-1" });
    (prisma.builderForm.create as any).mockResolvedValue({ id: "form-1", name: "Intake", slug: "intake", status: "DRAFT", icon: null });
    (prisma.builderForm.delete as any).mockResolvedValue({ id: "form-1" });
    await service.createForm("tenant-1", { name: "Intake", slug: "intake" } as any);
    await service.deleteForm("tenant-1", "form-1");
    expect(artifacts.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", artifactType: "FORM", artifactId: "form-1", slug: "intake" }));
    expect(artifacts.retire).toHaveBeenCalledWith("tenant-1", "FORM", "form-1");
  });

  it("projects a form revision into the canonical Library source model", async () => {
    const canonicalArtifacts = { record: vi.fn(async () => ({ id: "artifact-1" })), retire: vi.fn() };
    const revisions = { syncLegacyProjection: vi.fn() };
    const service = new BuilderFormsService(canonicalArtifacts as any, revisions as any);
    (prisma.builderForm.findFirst as any).mockResolvedValue(null);
    (prisma.builderForm.create as any).mockResolvedValue({ id: "form-1", name: "Intake", slug: "intake", status: "DRAFT", icon: null, description: null, fields: [{ id: "email", name: "email", type: "email", label: "Email", required: true }], pages: [], conditions: [], settings: {} });
    await service.createForm("tenant-1", { name: "Intake", slug: "intake" } as any);
    expect(revisions.syncLegacyProjection).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "artifact-1", scope: { kind: "LIBRARY" }, source: expect.objectContaining({ kind: "FORM", spec: expect.objectContaining({ pages: [expect.objectContaining({ fields: [expect.objectContaining({ name: "email" })] })] }) }) }));
  });

  it("projects the typed Data Object submission binding and dependency", async () => {
    const canonicalArtifacts = { record: vi.fn(async () => ({ id: "artifact-form" })), retire: vi.fn() };
    const revisions = { syncLegacyProjection: vi.fn() };
    const service = new BuilderFormsService(canonicalArtifacts as any, revisions as any);
    (prisma.builderForm.findFirst as any).mockResolvedValue(null);
    (prisma.builderForm.create as any).mockResolvedValue({ id: "form-1", name: "Intake", slug: "intake", status: "DRAFT", fields: [{ id: "email", name: "email", type: "email", label: "Email" }], pages: [], settings: { submitTargetArtifactId: "artifact-data", submitFieldMap: { email: "contact_email" } } });
    await service.createForm("tenant-1", { name: "Intake", slug: "intake" } as any);
    expect(revisions.syncLegacyProjection).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ spec: expect.objectContaining({ submit: { action: "CREATE_RECORD", targetArtifactId: "artifact-data", fieldMap: { email: "contact_email" } } }), dependencies: [{ targetArtifactId: "artifact-data" }], capabilities: ["data.write"] }) }));
  });

  it("mirrors workflow create and deletion to a Library artifact identity", async () => {
    const service = new BuilderWorkflowsService(artifacts as any);
    (prisma.builderWorkflow.create as any).mockResolvedValue({ id: "workflow-1", name: "Approval", status: "DRAFT" });
    (prisma.builderWorkflow.findFirst as any).mockResolvedValue({ id: "workflow-1", tenantId: "tenant-1" });
    (prisma.builderWorkflow.delete as any).mockResolvedValue({ id: "workflow-1" });
    await service.createWorkflow("tenant-1", { name: "Approval" });
    await service.deleteWorkflow("tenant-1", "workflow-1");
    expect(artifacts.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", artifactType: "WORKFLOW", artifactId: "workflow-1" }));
    expect(artifacts.retire).toHaveBeenCalledWith("tenant-1", "WORKFLOW", "workflow-1");
  });

  it("projects a workflow revision into the canonical Library source model", async () => {
    const canonicalArtifacts = { record: vi.fn(async () => ({ id: "artifact-2" })), retire: vi.fn() };
    const revisions = { syncLegacyProjection: vi.fn() };
    const service = new BuilderWorkflowsService(canonicalArtifacts as any, revisions as any);
    (prisma.builderWorkflow.create as any).mockResolvedValue({ id: "workflow-1", name: "Approval", status: "DRAFT", trigger: "SUBMIT", nodes: [{ id: "start", type: "START" }], edges: [], settings: {} });
    await service.createWorkflow("tenant-1", { name: "Approval" });
    expect(revisions.syncLegacyProjection).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "artifact-2", scope: { kind: "LIBRARY" }, source: expect.objectContaining({ kind: "WORKFLOW", spec: expect.objectContaining({ trigger: { type: "SUBMIT", configuration: {} } }) }) }));
  });

  it("mirrors dashboard create and deletion to a Library artifact identity", async () => {
    const service = new BuilderDashboardsService(artifacts as any);
    (prisma.builderDashboard.create as any).mockResolvedValue({ id: "dashboard-1", name: "Pipeline", status: "DRAFT", icon: "chart" });
    (prisma.builderDashboard.findFirst as any).mockResolvedValue({ id: "dashboard-1", tenantId: "tenant-1" });
    (prisma.builderDashboard.delete as any).mockResolvedValue({ id: "dashboard-1" });
    await service.createDashboard("tenant-1", { name: "Pipeline" });
    await service.deleteDashboard("tenant-1", "dashboard-1");
    expect(artifacts.record).toHaveBeenCalledWith(expect.objectContaining({ artifactType: "DASHBOARD", artifactId: "dashboard-1" }));
    expect(artifacts.retire).toHaveBeenCalledWith("tenant-1", "DASHBOARD", "dashboard-1");
  });

  it("projects a dashboard revision into canonical Library source", async () => {
    const canonicalArtifacts = { record: vi.fn(async () => ({ id: "artifact-dashboard" })), retire: vi.fn() };
    const revisions = { syncLegacyProjection: vi.fn() };
    const service = new BuilderDashboardsService(canonicalArtifacts as any, revisions as any);
    (prisma.builderDashboard.create as any).mockResolvedValue({ id: "dashboard-1", name: "Pipeline", status: "DRAFT", icon: null, widgets: [], layout: {}, refreshRate: 300 });
    await service.createDashboard("tenant-1", { name: "Pipeline" });
    expect(revisions.syncLegacyProjection).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "artifact-dashboard", scope: { kind: "LIBRARY" }, source: expect.objectContaining({ kind: "DASHBOARD" }) }));
  });
});
