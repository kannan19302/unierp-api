import { Injectable } from "@nestjs/common";

export interface GovernorFinding { dimension: string; level: "PASS" | "WARN" | "FAIL"; usage: number; softLimit: number; hardLimit: number; message: string }
export const DEFAULT_GOVERNOR_LIMITS = {
  artifacts: { soft: 2_000, hard: 10_000 }, packages: { soft: 50, hard: 200 },
  bindings: { soft: 50, hard: 250 }, sourceBytes: { soft: 1_048_576, hard: 4_194_304 },
  previewSessions: { soft: 5, hard: 20 },
} as const;
export type GovernorDimension = keyof typeof DEFAULT_GOVERNOR_LIMITS;
export type GovernorLimitOverrides = Partial<Record<GovernorDimension, { soft: number; hard: number }>>;

/** Shared cost/noisy-neighbour governor for builder, validation and runtime
 * paths. Tenant entitlement overrides can be layered onto these defaults
 * without changing every builder's implementation. */
@Injectable()
export class ProjectGovernorService {
  evaluate(composition: { artifacts: Array<{ source: unknown }>; packages: unknown[]; requiredBindings: unknown[] }, overrides?: GovernorLimitOverrides): GovernorFinding[] {
    const sourceBytes = Buffer.byteLength(JSON.stringify(composition.artifacts.map((artifact) => artifact.source)), "utf8");
    return [
      this.finding("artifacts", composition.artifacts.length, overrides), this.finding("packages", composition.packages.length, overrides),
      this.finding("bindings", composition.requiredBindings.length, overrides), this.finding("sourceBytes", sourceBytes, overrides),
    ];
  }
  private finding(dimension: GovernorDimension, usage: number, overrides?: GovernorLimitOverrides): GovernorFinding {
    const limit = overrides?.[dimension] ?? DEFAULT_GOVERNOR_LIMITS[dimension]; const level = usage > limit.hard ? "FAIL" : usage > limit.soft ? "WARN" : "PASS";
    return { dimension, level, usage, softLimit: limit.soft, hardLimit: limit.hard, message: `${dimension} uses ${usage}/${limit.hard}` };
  }
}
