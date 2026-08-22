import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { Prisma } from "@prisma/client";
import { ProjectReleasesService, releaseDigest } from "./project-releases.service";

type TestCase = { id?: string; type: "ASSERT_ARTIFACT_KIND" | "ASSERT_REQUIRED_BINDING" | "ASSERT_PACKAGE_INSTALLED"; value: string };

@Injectable()
export class ProjectTestRunsService {
  private readonly db = prisma as any;
  constructor(private readonly releases: ProjectReleasesService) {}

  list(tenantId: string, projectId: string) {
    return this.db.projectTestRun.findMany({ where: { tenantId, projectId }, orderBy: { startedAt: "desc" }, take: 25 });
  }

  async run(input: { tenantId: string; projectId: string; startedBy?: string | null }) {
    const composition = await this.releases.currentComposition(input.tenantId, input.projectId);
    const suites = composition.artifacts.filter((artifact) => artifact.artifactType === "TEST_SUITE");
    const cases = suites.flatMap((suite) => Array.isArray((suite.source as any)?.spec?.cases) ? (suite.source as any).spec.cases.map((item: TestCase, index: number) => ({ suiteId: suite.artifactId, id: item.id ?? `${suite.artifactId}:${index + 1}`, ...item })) : []);
    const results = cases.map((test: TestCase & { suiteId: string }) => this.execute(test, composition));
    const passed = results.every((result) => result.status === "PASS");
    const evidence = results.map((result) => ({ kind: "TEST_CASE", id: result.id, digest: releaseDigest(result) }));
    return this.db.projectTestRun.create({ data: {
      tenantId: input.tenantId, projectId: input.projectId, sourceFingerprint: composition.fingerprint,
      status: passed ? "PASSED" : "FAILED",
      summary: { suites: suites.length, cases: results.length, passed: results.filter((result) => result.status === "PASS").length, failed: results.filter((result) => result.status === "FAIL").length, results },
      evidence: evidence as Prisma.InputJsonValue, startedBy: input.startedBy ?? null, completedAt: new Date(),
    }});
  }

  private execute(test: TestCase & { suiteId: string }, composition: any) {
    const artifactKinds = new Set(composition.artifacts.map((artifact: any) => artifact.artifactType));
    const bindingKeys = new Set(composition.requiredBindings.map((binding: any) => binding.key));
    const packageIds = new Set(composition.packages.map((item: any) => item.packageId));
    const passed = test.type === "ASSERT_ARTIFACT_KIND" ? artifactKinds.has(test.value)
      : test.type === "ASSERT_REQUIRED_BINDING" ? bindingKeys.has(test.value)
      : test.type === "ASSERT_PACKAGE_INSTALLED" ? packageIds.has(test.value) : false;
    return { id: test.id ?? "unnamed", suiteId: test.suiteId, type: test.type, value: test.value, status: passed ? "PASS" : "FAIL" };
  }
}
