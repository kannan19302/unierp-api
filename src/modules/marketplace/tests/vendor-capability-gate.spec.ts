/**
 * M44 exit criterion (second half): "An extension declaring an
 * unsatisfied capability cannot be approved in C25's review queue."
 * approveBundle() calls this check (private assertCapabilitiesSatisfied)
 * immediately after manifest validation, before publishing — exercised
 * directly here since a full approveBundle() run also requires a valid
 * cryptographic signature, covered separately by vendor-signing.spec.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let capabilityStates: Record<string, "READY" | "UNSATISFIED">;

vi.mock("@kannan19302/shared", () => ({
  resolve: (capabilityId: string) => ({ state: capabilityStates[capabilityId] ?? "UNSATISFIED" }),
}));
vi.mock("@kannan19302/database", () => ({ prisma: {} }));
vi.mock("@kannan19302/extension-api", () => ({ bundleDigestInput: vi.fn() }));

import { VendorService } from "../vendor.service";
import type { AppManifest } from "../manifest";

describe("M44 · C25 review queue refuses an extension with an unsatisfied declared capability", () => {
  let service: VendorService;

  beforeEach(() => {
    vi.clearAllMocks();
    capabilityStates = {};
    service = new VendorService({} as any);
  });

  function manifest(capabilities?: string[]): AppManifest {
    return {
      name: "Test Extension",
      slug: "test-extension",
      version: "1.0.0",
      category: "productivity",
      vendor: "acme",
      runtime: "declarative",
      ...(capabilities ? { capabilities } : {}),
    } as AppManifest;
  }

  it("REFUSES approval when a declared capability has no bound provider (UNSATISFIED)", () => {
    capabilityStates["dns.manage"] = "UNSATISFIED";
    expect(() => (service as any).assertCapabilitiesSatisfied(manifest(["dns.manage"]))).toThrow(
      /unsatisfied capabilities dns\.manage/,
    );
  });

  it("APPROVES when every declared capability is READY", () => {
    capabilityStates["email.send"] = "READY";
    capabilityStates["dns.manage"] = "READY";
    expect(() => (service as any).assertCapabilitiesSatisfied(manifest(["email.send", "dns.manage"]))).not.toThrow();
  });

  it("a manifest declaring NO capabilities is unaffected — nothing to check, nothing blocks it", () => {
    expect(() => (service as any).assertCapabilitiesSatisfied(manifest())).not.toThrow();
    expect(() => (service as any).assertCapabilitiesSatisfied(manifest([]))).not.toThrow();
  });

  it("names every unsatisfied capability, not just the first — a reviewer sees the whole gap at once", () => {
    capabilityStates["dns.manage"] = "READY";
    capabilityStates["llm.complete"] = "UNSATISFIED";
    capabilityStates["object.store"] = "UNSATISFIED";
    try {
      (service as any).assertCapabilitiesSatisfied(manifest(["dns.manage", "llm.complete", "object.store"]));
      throw new Error("expected assertCapabilitiesSatisfied to throw");
    } catch (e: any) {
      expect(e.message).toContain("llm.complete");
      expect(e.message).toContain("object.store");
      expect(e.message).not.toContain("dns.manage,"); // the READY one is not listed as unsatisfied
    }
  });
});
