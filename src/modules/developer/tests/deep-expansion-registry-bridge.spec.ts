import { describe, expect, it, vi } from "vitest";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));
vi.mock("@/common/idp-client", () => ({ idpClient: {} }));

import { prisma } from "@kannan19302/database";
import { BuilderDeepExpansionService } from "../services/builder-deep-expansion.service";

describe("deep expansion registry bridge", () => {
  it("registers new data models as reusable DATA_OBJECT artifacts", async () => {
    const artifacts = { record: vi.fn(async () => ({ id: "artifact-1" })) };
    const revisions = { syncLegacyProjection: vi.fn() };
    (prisma as any).builderDataModel = { create: vi.fn(async () => ({ id: "model-1", name: "Invoice", tableName: "custom_invoices", isPublished: false, icon: "database" })) };
    const service = new BuilderDeepExpansionService(artifacts as any, revisions as any);
    await service.createDataModel("tenant-1", { name: "Invoice", tableName: "custom_invoices", fields: [] });
    expect(artifacts.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", artifactType: "DATA_OBJECT", artifactId: "model-1", slug: "custom_invoices", status: "DRAFT" }));
    expect(revisions.syncLegacyProjection).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "artifact-1", scope: { kind: "LIBRARY" }, source: expect.objectContaining({ kind: "DATA_OBJECT" }) }));
  });

  it("projects connector metadata without persisting credentials in canonical source", async () => {
    const artifacts = { record: vi.fn(async () => ({ id: "connector-artifact" })) };
    const revisions = { syncLegacyProjection: vi.fn() };
    (prisma as any).integrationConnector = { create: vi.fn(async () => ({ id: "connector-1", name: "Payments", connectorType: "REST", authType: "API_KEY", credentials: { apiKey: "secret" }, headers: { Accept: "application/json" }, isActive: true, connectorIntegrations: [] })) };
    const service = new BuilderDeepExpansionService(artifacts as any, revisions as any);
    await service.createIntegrationConnector("tenant-1", { name: "Payments", connectorType: "REST", credentials: { apiKey: "secret" } });
    const source = revisions.syncLegacyProjection.mock.calls[0][0].source;
    expect(source.kind).toBe("CONNECTOR_DEFINITION");
    expect(JSON.stringify(source)).not.toContain("secret");
    expect(source.spec).toMatchObject({ connectorType: "REST", authType: "API_KEY" });
  });
});
