import { describe, it, expect } from "vitest";
import { SaasPortalService } from "../saas-portal.service";

/**
 * Proves the catalog endpoint actually reflects module-tiers.ts / app-slug-map.ts
 * — the same tables entitlement.middleware.ts gates routes against — rather
 * than drifting into a sixth hand-maintained list.
 */
describe("SaasPortalService.getAppCatalog", () => {
  const service = new SaasPortalService();

  it("returns kernel modules marked kernel: true", () => {
    const { modules } = service.getAppCatalog();
    const kernelSlugs = modules.filter((m) => m.kernel).map((m) => m.slug);

    expect(kernelSlugs).toContain("saas-portal");
    expect(kernelSlugs).toContain("app-store");
  });

  it("returns core gated modules with their real route segments", () => {
    const { modules } = service.getAppCatalog();
    const finance = modules.find((m) => m.slug === "finance");

    expect(finance).toBeDefined();
    expect(finance?.kernel).toBe(false);
    expect(finance?.segments).toContain("finance");
  });

  it("maps a module served under a different segment than its slug correctly", () => {
    // Connect -> communication is the documented case of a slug/segment
    // mismatch this table exists to resolve.
    const { modules } = service.getAppCatalog();
    const communication = modules.find((m) => m.slug === "communication");

    expect(communication?.segments).toEqual(
      expect.arrayContaining(["connect", "communication"]),
    );
  });

  it("includes known industry bundles, flagged distinctly from core modules", () => {
    // KNOWN_INDUSTRY_APP_SLUGS (app-slug-map.ts) is currently
    // ["education", "real-estate", "field-service"] — deliberately not
    // hardcoding the list itself here, only one representative member, so
    // this test does not become a sixth copy of the same slug list.
    const { modules } = service.getAppCatalog();
    const education = modules.find((m) => m.slug === "education");

    expect(education).toBeDefined();
    expect(education?.industryBundle).toBe(true);
    expect(education?.kernel).toBe(false);
  });

  it("never marks an industry bundle or core module as kernel", () => {
    const { modules } = service.getAppCatalog();
    const nonKernel = modules.filter((m) => m.slug !== "saas-portal" && m.slug !== "app-store");

    expect(nonKernel.every((m) => m.kernel === false)).toBe(true);
  });

  it("produces no duplicate slugs across kernel, core and industry sets", () => {
    const { modules } = service.getAppCatalog();
    const slugs = modules.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
