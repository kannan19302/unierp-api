import { describe, expect, it, vi } from "vitest";
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
import { ProjectTestRunsService } from "./project-test-runs.service";

const composition = {
  fingerprint: "fingerprint-1", packages: [{ packageId: "pkg-1" }], requiredBindings: [{ key: "crm" }],
  artifacts: [
    { artifactId: "form-1", artifactType: "FORM", source: {} },
    { artifactId: "suite-1", artifactType: "TEST_SUITE", source: { spec: { cases: [
      { id: "form", type: "ASSERT_ARTIFACT_KIND", value: "FORM" }, { id: "binding", type: "ASSERT_REQUIRED_BINDING", value: "crm" },
    ] } } },
  ],
};
describe("ProjectTestRunsService", () => {
  it("persists passing test evidence against the exact composition fingerprint", async () => {
    const service = new ProjectTestRunsService({ currentComposition: vi.fn(async () => composition) } as any);
    (service as any).db = { projectTestRun: { create: vi.fn(async ({ data }: any) => data) } };
    const result = await service.run({ tenantId: "tenant-1", projectId: "project-1" });
    expect(result).toMatchObject({ sourceFingerprint: "fingerprint-1", status: "PASSED", summary: { cases: 2, passed: 2 } });
    expect(result.evidence).toHaveLength(2);
  });
  it("fails the run when an assertion does not match the composition", async () => {
    const failed = { ...composition, artifacts: [{ ...composition.artifacts[0] }, { ...composition.artifacts[1], source: { spec: { cases: [{ type: "ASSERT_ARTIFACT_KIND", value: "WORKFLOW" }] } } }] };
    const service = new ProjectTestRunsService({ currentComposition: vi.fn(async () => failed) } as any);
    (service as any).db = { projectTestRun: { create: vi.fn(async ({ data }: any) => data) } };
    await expect(service.run({ tenantId: "tenant-1", projectId: "project-1" })).resolves.toMatchObject({ status: "FAILED", summary: { failed: 1 } });
  });
});
