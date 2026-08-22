import { describe, expect, it, vi } from "vitest";

vi.mock("@kannan19302/database", () => ({ prisma: {} }));

import { prisma } from "@kannan19302/database";
import { ArtifactRegistryService, RECONCILABLE_ARTIFACT_PROJECTIONS } from "./artifact-registry.service";

describe("ArtifactRegistryService reconciliation", () => {
  it("checks every supported legacy projection without reporting zero-drift kinds", async () => {
    const raw = vi.fn(async (_query: string, _tenantId: string, type: string) => [{ missing: type === "PAGE" ? BigInt(2) : BigInt(0) }]);
    (prisma as any).$queryRawUnsafe = raw;
    const result = await new ArtifactRegistryService().reconcile("tenant-1");
    expect(raw).toHaveBeenCalledTimes(RECONCILABLE_ARTIFACT_PROJECTIONS.length);
    expect(result).toEqual([{ artifactType: "PAGE", missing: 2 }]);
    expect(RECONCILABLE_ARTIFACT_PROJECTIONS.map((projection) => projection.type)).toEqual(expect.arrayContaining(["FORM", "PAGE", "COLLECTION", "BLOG_POST", "CONNECTOR_DEFINITION"]));
  });
});
