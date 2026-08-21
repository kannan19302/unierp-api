/**
 * API deprecation registry (Foundation Roadmap Track G.1).
 *
 * The single place where API surface deprecations are declared. The
 * deprecation middleware consults this registry on every request and emits
 * RFC 9745 `Deprecation`, RFC 8594 `Sunset`, and successor `Link` headers.
 *
 * Policy: see docs/API_VERSIONING_POLICY.md — nothing is removed while a
 * paying tenant's integration depends on it inside the sunset window; every
 * entry must name a successor or a migration guide link.
 */

export interface DeprecationEntry {
  /** Path prefix AFTER the global prefix, e.g. "/api/v1/legacy-reports". */
  pathPrefix: string;
  /** When the surface became deprecated (announcement date). */
  deprecatedAt: Date;
  /** When it will stop working. Omit while "deprecated, no removal date". */
  sunsetAt?: Date;
  /** Successor URI (absolute or path) for Link rel="successor-version". */
  successor?: string;
  /** Human docs / migration guide. */
  link?: string;
}

/**
 * Live registry. Add entries here (never delete before their sunset passes;
 * move expired entries to the policy doc's history table).
 *
 * The `/api/v1/builder/*` entries below are stage 1 of the developer
 * platform's project-first reshape: **announce, with no `sunsetAt`**. That
 * omission is deliberate, not an oversight — nobody currently knows whether
 * `/builder/etl/pipelines` has one caller or a hundred, and announcing a
 * removal date before you can measure the traffic is how integrations get
 * broken. A usage counter keyed by (prefix, tenant) comes next; the sunset
 * date comes after that, at least two release cycles out.
 *
 * Successors are chosen by SEMANTICS, not by name similarity:
 * `/builder/forms` returns every form the tenant owns, which is what
 * `/library/forms` does today — NOT what `/apps/:appId/forms` will do. Where
 * no successor preserves the old behaviour, the entry points at the
 * migration guide rather than lying about an equivalent.
 */
export const API_DEPRECATIONS: DeprecationEntry[] = [
  {
    pathPrefix: "/api/v1/builder",
    deprecatedAt: new Date("2026-08-20T00:00:00Z"),
    successor: "/api/v1/dev",
    link: "https://docs.unierp.dev/api/migrations/builder-to-projects",
  },
  {
    // Longer prefix wins, so the web-studio half carries its own successor.
    pathPrefix: "/api/v1/builder/web-studio",
    deprecatedAt: new Date("2026-08-20T00:00:00Z"),
    successor: "/api/v1/dev/sites",
    link: "https://docs.unierp.dev/api/migrations/builder-to-projects",
  },
  {
    pathPrefix: "/api/v1/builder/modules",
    deprecatedAt: new Date("2026-08-20T00:00:00Z"),
    successor: "/api/v1/dev/apps",
    link: "https://docs.unierp.dev/api/migrations/builder-to-projects",
  },
];

/** Longest-prefix match so nested surfaces can carry their own clocks. */
export function findDeprecation(
  path: string,
  registry: DeprecationEntry[] = API_DEPRECATIONS,
): DeprecationEntry | null {
  let best: DeprecationEntry | null = null;
  for (const entry of registry) {
    if (!path.startsWith(entry.pathPrefix)) continue;
    if (!best || entry.pathPrefix.length > best.pathPrefix.length) best = entry;
  }
  return best;
}
