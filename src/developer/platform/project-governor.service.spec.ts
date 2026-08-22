import { describe, expect, it } from "vitest";
import { ProjectGovernorService } from "./project-governor.service";
describe("ProjectGovernorService", () => {
  it("reports a hard failure before an oversized source composition reaches runtime", () => {
    const result = new ProjectGovernorService().evaluate({ artifacts: [{ source: "x".repeat(4_194_305) }], packages: [], requiredBindings: [] });
    expect(result).toContainEqual(expect.objectContaining({ dimension: "sourceBytes", level: "FAIL" }));
  });
  it("reports soft pressure without blocking a composition", () => {
    const result = new ProjectGovernorService().evaluate({ artifacts: [], packages: Array.from({ length: 51 }), requiredBindings: [] });
    expect(result).toContainEqual(expect.objectContaining({ dimension: "packages", level: "WARN" }));
  });
  it("uses an approved tenant entitlement override through the same governor contract", () => {
    const result = new ProjectGovernorService().evaluate({ artifacts: [], packages: Array.from({ length: 51 }), requiredBindings: [] }, { packages: { soft: 60, hard: 80 } });
    expect(result).toContainEqual(expect.objectContaining({ dimension: "packages", level: "PASS", hardLimit: 80 }));
  });
});
