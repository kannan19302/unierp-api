import { describe, expect, it, vi } from "vitest";
import { DeveloperPackagesController } from "./developer-packages.controller";
import { EnvironmentBindingsController } from "./environment-bindings.controller";
import { ProjectArtifactsController } from "./project-artifacts.controller";
import { ProjectTestRunsController } from "./project-test-runs.controller";

const req = { user: { tenantId: "tenant-1", userId: "user-1", email: "user@example.test", roles: ["MAKER"] } } as any;

describe("project-bound developer platform controllers", () => {
  it("does not install a package before the project ABAC overlay permits authoring", async () => {
    const packages = { install: vi.fn() };
    const authorization = { assertProjectAction: vi.fn(async () => { throw new Error("denied"); }) };
    const controller = new DeveloperPackagesController(packages as any, authorization as any);
    await expect(controller.install(req, "project-1", { packageVersionId: "version-1", mode: "PINNED", resourceMappings: {}, capabilityGrants: [] } as any)).rejects.toThrow("denied");
    expect(packages.install).not.toHaveBeenCalled();
  });

  it("requires release authority before verifying an environment binding", async () => {
    const bindings = { verify: vi.fn(async () => ({})) };
    const authorization = { assertProjectAction: vi.fn(async () => undefined) };
    const controller = new EnvironmentBindingsController(bindings as any, authorization as any);
    await controller.verify(req, "project-1", "environment-1", "crm");
    expect(authorization.assertProjectAction).toHaveBeenCalledWith("tenant-1", "project-1", req.user, "RELEASE");
  });

  it("checks authoring access before exposing project artifact inventory", async () => {
    const registry = { listForProject: vi.fn(async () => []) };
    const authorization = { assertProjectAction: vi.fn(async () => undefined) };
    const controller = new ProjectArtifactsController(registry as any, authorization as any);
    await controller.list(req, "project-1");
    expect(authorization.assertProjectAction).toHaveBeenCalledWith("tenant-1", "project-1", req.user, "AUTHOR");
  });

  it("checks authoring access before exposing immutable test-run evidence", async () => {
    const tests = { list: vi.fn(async () => []) };
    const authorization = { assertProjectAction: vi.fn(async () => undefined) };
    const controller = new ProjectTestRunsController(tests as any, authorization as any);
    await controller.list(req, "project-1");
    expect(authorization.assertProjectAction).toHaveBeenCalledWith("tenant-1", "project-1", req.user, "AUTHOR");
  });
});
