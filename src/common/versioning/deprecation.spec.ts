import { beforeEach, describe, expect, it } from "vitest";
import { findDeprecation, type DeprecationEntry } from "./deprecation-registry";
import {
  applyDeprecationHeaders,
  deprecationMiddleware,
} from "./deprecation.middleware";
import { deprecationUsage, __resetDeprecationUsage } from "./deprecation-usage";

const registry: DeprecationEntry[] = [
  {
    pathPrefix: "/api/v1/legacy-reports",
    deprecatedAt: new Date("2026-07-01T00:00:00Z"),
    sunsetAt: new Date("2027-01-01T00:00:00Z"),
    successor: "/api/v2/reports",
    link: "https://docs.unerp.dev/migrations/reports-v2",
  },
  {
    pathPrefix: "/api/v1/legacy-reports/exports",
    deprecatedAt: new Date("2026-06-01T00:00:00Z"),
  },
];

function fakeResponse() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
}

describe("deprecation registry (Track G.1)", () => {
  it("longest-prefix wins for nested surfaces", () => {
    expect(
      findDeprecation("/api/v1/legacy-reports/summary", registry)?.pathPrefix,
    ).toBe("/api/v1/legacy-reports");
    expect(
      findDeprecation("/api/v1/legacy-reports/exports/csv", registry)
        ?.pathPrefix,
    ).toBe("/api/v1/legacy-reports/exports");
  });

  it("returns null for unregistered paths (and the live registry is empty)", () => {
    expect(findDeprecation("/api/v1/orders", registry)).toBeNull();
    expect(findDeprecation("/api/v1/anything")).toBeNull();
  });
});

describe("deprecation headers (Track G.1)", () => {
  it("emits RFC 9745 Deprecation, RFC 8594 Sunset, and successor Links", () => {
    const response = fakeResponse();
    applyDeprecationHeaders(response as never, registry[0]);
    expect(response.headers["Deprecation"]).toBe(
      `@${Math.floor(registry[0].deprecatedAt.getTime() / 1000)}`,
    );
    expect(response.headers["Sunset"]).toBe("Fri, 01 Jan 2027 00:00:00 GMT");
    expect(response.headers["Link"]).toContain('rel="successor-version"');
    expect(response.headers["Link"]).toContain('rel="deprecation"');
  });

  it("omits Sunset/Link when not declared", () => {
    const response = fakeResponse();
    applyDeprecationHeaders(response as never, registry[1]);
    expect(response.headers["Deprecation"]).toBeDefined();
    expect(response.headers["Sunset"]).toBeUndefined();
    expect(response.headers["Link"]).toBeUndefined();
  });

  it("middleware decorates matching requests and ignores others", () => {
    const middleware = deprecationMiddleware(registry);
    const hit = fakeResponse();
    let nextCalls = 0;
    middleware(
      { path: "/api/v1/legacy-reports" } as never,
      hit as never,
      () => {
        nextCalls += 1;
      },
    );
    const miss = fakeResponse();
    middleware({ path: "/api/v1/orders" } as never, miss as never, () => {
      nextCalls += 1;
    });
    expect(nextCalls).toBe(2);
    expect(hit.headers["Deprecation"]).toBeDefined();
    expect(miss.headers["Deprecation"]).toBeUndefined();
  });
});

/**
 * The LIVE registry, not a fixture. These assert the properties the
 * developer-platform reshape depends on — that the announcement actually
 * reaches callers, and that it does not accidentally promise a removal date
 * or shadow a still-current surface.
 */
describe("live builder deprecations (developer platform reshape)", () => {
  it("announces the legacy builder surface", () => {
    const entry = findDeprecation("/api/v1/builder/forms");
    expect(entry).not.toBeNull();
    expect(entry!.successor).toBeDefined();
  });

  it("carries no sunset date yet", () => {
    // Deliberate: a removal date announced before traffic is measured is how
    // integrations get broken. Flipping this test is the conscious act of
    // committing to a removal date.
    for (const path of [
      "/api/v1/builder/forms",
      "/api/v1/builder/web-studio/sites",
      "/api/v1/builder/modules",
    ]) {
      expect(findDeprecation(path)?.sunsetAt).toBeUndefined();
    }
  });

  it("routes each sub-surface to the successor that matches its semantics", () => {
    expect(findDeprecation("/api/v1/builder/web-studio/sites")?.successor).toBe(
      "/api/v1/dev/sites",
    );
    expect(findDeprecation("/api/v1/builder/modules")?.successor).toBe(
      "/api/v1/dev/apps",
    );
  });

  it("does not mark the new /dev surface or unrelated routes as deprecated", () => {
    // A prefix typo here would deprecate the replacement on day one.
    expect(findDeprecation("/api/v1/dev/home")).toBeNull();
    expect(findDeprecation("/api/v1/public/web/site")).toBeNull();
    expect(findDeprecation("/api/v1/orders")).toBeNull();
  });
});

describe("deprecation usage counters (P4 stage 2)", () => {
  beforeEach(() => __resetDeprecationUsage());

  it("counts calls per (prefix, tenant) so you know WHO to notify", () => {
    const middleware = deprecationMiddleware(registry);
    const call = (tenantId?: string) =>
      middleware(
        { path: "/api/v1/legacy-reports", user: tenantId ? { tenantId } : undefined } as never,
        fakeResponse() as never,
        () => {},
      );
    call("tnt-a");
    call("tnt-a");
    call("tnt-b");

    const rows = deprecationUsage();
    expect(rows).toHaveLength(2);
    // Sorted by count desc — the noisiest caller first is the one you act on.
    expect(rows[0]).toMatchObject({ tenantId: "tnt-a", count: 2 });
    expect(rows[1]).toMatchObject({ tenantId: "tnt-b", count: 1 });
  });

  it("records anonymous callers as 'unknown' rather than dropping them", () => {
    // An un-authenticated probe still tells you the surface is reachable and
    // in use; silently discarding it would understate the traffic.
    const middleware = deprecationMiddleware(registry);
    middleware({ path: "/api/v1/legacy-reports" } as never, fakeResponse() as never, () => {});
    expect(deprecationUsage()[0]).toMatchObject({ tenantId: "unknown", count: 1 });
  });

  it("does not count requests that are not deprecated", () => {
    const middleware = deprecationMiddleware(registry);
    middleware({ path: "/api/v1/orders" } as never, fakeResponse() as never, () => {});
    expect(deprecationUsage()).toHaveLength(0);
  });
});
