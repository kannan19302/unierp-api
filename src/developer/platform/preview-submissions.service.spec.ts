import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
import { PreviewSubmissionsService } from "./preview-submissions.service";

const form = { artifactId: "form-artifact", kind: "FORM", source: { spec: { pages: [{ fields: [{ id: "email" }, { id: "age" }] }], submit: { targetArtifactId: "object-artifact", fieldMap: { age: "customer_age" } } } } };
const objectArtifact = { artifactId: "object-artifact", kind: "DATA_OBJECT", source: { spec: { objectDefinitionId: "object-definition" } } };
const object = { id: "object-definition", tableName: "co_safe_object", fields: [{ name: "email", type: "string", required: true }, { name: "customer_age", type: "int", required: false }] };

describe("PreviewSubmissionsService", () => {
  let service: PreviewSubmissionsService;
  let query: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    service = new PreviewSubmissionsService();
    query = vi.fn(async () => [{ id: "record-1", created_at: new Date("2026-01-01T00:00:00Z") }]);
    (service as any).db = { customObjectDefinition: { findFirst: vi.fn(async () => object) }, $queryRaw: query, developerAuditEvent: { create: vi.fn(async () => undefined) } };
  });

  it("persists only fields declared by both the pinned Form and bound Data Object", async () => {
    await expect(service.submit({ tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", formArtifactId: "form-artifact", values: { email: "pilot@example.test", age: "42" }, artifacts: [form, objectArtifact] })).resolves.toMatchObject({ id: "record-1", dataObjectArtifactId: "object-artifact" });
    expect(query).toHaveBeenCalledOnce();
  });

  it("rejects an undeclared Form field before persistence", async () => {
    await expect(service.submit({ tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", formArtifactId: "form-artifact", values: { email: "ok", admin: true }, artifacts: [form, objectArtifact] })).rejects.toThrow(/not declared by the Form/);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects type confusion and missing required values", async () => {
    await expect(service.submit({ tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", formArtifactId: "form-artifact", values: { email: "ok", age: "not-an-int" }, artifacts: [form, objectArtifact] })).rejects.toThrow(/must be an integer/);
    await expect(service.submit({ tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", formArtifactId: "form-artifact", values: { age: "4" }, artifacts: [form, objectArtifact] })).rejects.toThrow(/email.*required/);
    expect(query).not.toHaveBeenCalled();
  });

  it("requires the Data Object to resolve inside the same composition and tenant", async () => {
    await expect(service.submit({ tenantId: "tenant-1", projectId: "project-1", previewId: "preview-1", formArtifactId: "form-artifact", values: { email: "ok" }, artifacts: [form] })).rejects.toThrow(/not part of this preview composition/);
    (service as any).db.customObjectDefinition.findFirst = vi.fn(async () => null);
    await expect(service.submit({ tenantId: "tenant-2", projectId: "project-1", previewId: "preview-1", formArtifactId: "form-artifact", values: { email: "ok" }, artifacts: [form, objectArtifact] })).rejects.toThrow(/tenant Data Object/);
    expect(query).not.toHaveBeenCalled();
  });
});
