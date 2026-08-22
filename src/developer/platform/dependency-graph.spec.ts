import { describe, expect, it } from "vitest";
import { findArtifactDependencyCycles } from "./dependency-graph";
describe("findArtifactDependencyCycles", () => {
  it("finds resolved cycles but ignores unresolved portable coordinates", () => {
    expect(findArtifactDependencyCycles([{ artifactId: "a", dependencies: [{ targetArtifactId: "b" }] }, { artifactId: "b", dependencies: [{ targetArtifactId: "a" }] }, { artifactId: "c", dependencies: [{}] }])).toEqual([["a", "b", "a"]]);
  });
});
