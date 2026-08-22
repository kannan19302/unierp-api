import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { prisma, runWithTenantSession } from "@kannan19302/database";
import { ArtifactRevisionsService } from "../src/developer/platform/artifact-revisions.service";
import { ProjectReleasesService } from "../src/developer/platform/project-releases.service";
const tenantId = "itest-pilot-lifecycle", ctx = { tenantId, userId: "itest-author" };
const envelope = (id: string, kind: "FORM" | "PAGE") => ({ apiVersion: "unierp.dev/v1" as const, kind, metadata: { id, namespace: "itest.pilots", name: kind }, spec: kind === "FORM" ? { title: "Form", pages: [{ id: "main", fields: [] }] } : { title: "Home", slug: "/", sections: [] }, interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: {} });
describe("Integration: canonical App/Form and Site/Page pilots", () => {
  beforeAll(() => runWithTenantSession(ctx, () => prisma.tenant.upsert({ where: { id: tenantId }, create: { id: tenantId, name: "Pilot", slug: tenantId }, update: {} })));
  afterAll(() => runWithTenantSession(ctx, () => prisma.tenant.deleteMany({ where: { id: tenantId } })));
  it.each([{ kind: "APP", artifact: "FORM", slug: "app-pilot" }, { kind: "SITE", artifact: "PAGE", slug: "site-pilot" }] as const)("validates, signs, publishes, and promotes $kind/$artifact", async ({ kind, artifact, slug }) => runWithTenantSession(ctx, async () => {
    const target = kind === "APP" ? await prisma.builderModule.create({ data: { tenantId, name: slug, slug } }) : await prisma.webSite.create({ data: { tenantId, name: slug, slug } });
    const project = await prisma.devProject.create({ data: { tenantId, kind, name: slug, slug, appId: kind === "APP" ? target.id : null, siteId: kind === "SITE" ? target.id : null } });
    await new ArtifactRevisionsService().createImportedProjectArtifacts({ tenantId, projectId: project.id, createdBy: ctx.userId, artifacts: [{ id: `${slug}-artifact`, kind: artifact, source: envelope(`${slug}-artifact`, artifact) }] });
    const releases = new ProjectReleasesService();
    expect((await releases.validate({ tenantId, projectId: project.id, startedBy: ctx.userId })).status).toBe("PASSED");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keyId = `${slug}-key`;
    await prisma.devSigningKey.create({ data: { tenantId, keyId, label: keyId, publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64") } });
    const prepared = await releases.preparePublish({ tenantId, projectId: project.id, version: "1.0.0" });
    const signature = sign(null, Buffer.from(prepared.manifestHash, "utf8"), privateKey).toString("base64");
    const release = await releases.publish({ tenantId, projectId: project.id, version: "1.0.0", keyId, signature, releaseId: prepared.unsigned.releaseId, publishedBy: ctx.userId });
    const environment = await prisma.environment.create({ data: { tenantId, name: `${slug} Preview`, slug: `${slug}-preview`, type: "STAGING" } });
    expect((await releases.deploy({ tenantId, projectId: project.id, releaseId: release.id, environmentId: environment.id, deployedBy: ctx.userId })).status).toBe("SUCCESS");
  }));
});
