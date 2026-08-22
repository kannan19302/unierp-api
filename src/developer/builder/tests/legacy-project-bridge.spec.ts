import { describe, expect, it, vi } from "vitest";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));
vi.mock("@/common/idp-client", () => ({ idpClient: {} }));

import { prisma } from "@kannan19302/database";
import { BuilderService } from "../builder.service";
import { WebStudioService } from "../web-studio.service";

describe("legacy project creation bridge", () => {
  it("creates an App project identity in the same transaction as a legacy module", async () => {
    const moduleCreate = vi.fn(async () => ({ id: "app-1", name: "Sales", slug: "sales", description: "CRM", icon: "box", color: "blue", status: "DRAFT" }));
    const projectCreate = vi.fn(async () => ({ id: "project-1" }));
    (prisma as any).builderModule = { findFirst: vi.fn(async () => null) };
    (prisma as any).$transaction = (callback: any) => callback({ builderModule: { create: moduleCreate }, devProject: { create: projectCreate } });

    await expect(new BuilderService({} as any).createModule("tenant-1", { name: "Sales", slug: "sales", description: "CRM", createdBy: "maker-1" })).resolves.toMatchObject({ id: "app-1" });
    expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: "tenant-1", kind: "APP", appId: "app-1", createdBy: "maker-1" }) }));
  });

  it("creates a Site project identity in the same transaction as a legacy site", async () => {
    const siteCreate = vi.fn(async () => ({ id: "site-1", name: "Marketing", slug: "marketing", status: "ACTIVE" }));
    const projectCreate = vi.fn(async () => ({ id: "project-1" }));
    (prisma as any).$transaction = (callback: any) => callback({ webSite: { create: siteCreate }, devProject: { create: projectCreate } });

    await expect(new WebStudioService({} as any).createSite("tenant-1", { name: "Marketing" }, "maker-1")).resolves.toMatchObject({ id: "site-1" });
    expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: "tenant-1", kind: "SITE", siteId: "site-1", createdBy: "maker-1" }) }));
  });

  it("registers Web Studio pages as project-owned canonical artifacts", async () => {
    const artifacts = { record: vi.fn(async () => ({ id: "artifact-1" })) };
    const revisions = { syncLegacyProjection: vi.fn() };
    (prisma as any).webSite = { findFirst: vi.fn(async () => ({ id: "site-1", tenantId: "tenant-1" })) };
    (prisma as any).webSitePage = { upsert: vi.fn(async () => ({ id: "page-1", title: "Home", path: "/", status: "DRAFT", blocks: [{ component: "Hero", props: {} }], seo: { title: "Home" } })) };
    (prisma as any).devProject = { findFirst: vi.fn(async () => ({ id: "project-1" })) };
    const page = await new WebStudioService({} as any, artifacts as any, revisions as any).upsertPage("tenant-1", "site-1", { title: "Home", path: "/" });
    expect(page).toMatchObject({ id: "page-1" });
    expect(artifacts.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", artifactType: "PAGE", artifactId: "page-1", ownerProjectId: "project-1" }));
    expect(revisions.syncLegacyProjection).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "artifact-1", scope: { kind: "PROJECT", projectId: "project-1" }, source: expect.objectContaining({ kind: "PAGE", metadata: expect.objectContaining({ id: "artifact-1" }) }) }));
  });
});
