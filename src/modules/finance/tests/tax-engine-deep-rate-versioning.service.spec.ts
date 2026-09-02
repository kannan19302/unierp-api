/**
 * E12 exit criterion: "...rate changes versioned by effective date, never
 * retroactive (G-15)."
 *
 * TaxEngineDeepService.updateJurisdiction() previously accepted `rate` in
 * its partial DTO and mutated the existing taxJurisdiction row's rate
 * in place — with no new effective-dated version created. Since a single
 * row's effectiveFrom/effectiveTo window is meant to describe "which rate
 * applied over which date range," overwriting `rate` on that same row
 * silently rewrites the rate that applied to every date already inside
 * that window, including dates in the past. That is exactly the
 * retroactive rewrite G-15 forbids.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let jurisdictions: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    taxJurisdiction: {
      findFirst: vi.fn(({ where }: any) => {
        return (
          jurisdictions.find((j) => {
            if (where.id && j.id !== where.id) return false;
            if (where.tenantId && j.tenantId !== where.tenantId) return false;
            if (where.code && j.code !== where.code) return false;
            if (where.effectiveFrom?.lte && j.effectiveFrom > where.effectiveFrom.lte)
              return false;
            if (where.OR) {
              const ok = where.OR.some((cond: any) => {
                if ("effectiveTo" in cond && cond.effectiveTo === null)
                  return j.effectiveTo === null;
                if (cond.effectiveTo?.gte)
                  return j.effectiveTo && j.effectiveTo >= cond.effectiveTo.gte;
                return false;
              });
              if (!ok) return false;
            }
            return true;
          }) ?? null
        );
      }),
      update: vi.fn(({ where, data }: any) => {
        const j = jurisdictions.find((x) => x.id === where.id);
        Object.assign(j, data);
        return j;
      }),
      create: vi.fn(({ data }: any) => {
        const row = { id: `jx-${jurisdictions.length + 1}`, ...data };
        jurisdictions.push(row);
        return row;
      }),
    },
    $transaction: vi.fn(async (cb: any) =>
      cb({
        taxJurisdiction: {
          update: vi.fn(({ where, data }: any) => {
            const j = jurisdictions.find((x) => x.id === where.id);
            Object.assign(j, data);
            return j;
          }),
          create: vi.fn(({ data }: any) => {
            const row = { id: `jx-${jurisdictions.length + 1}`, ...data };
            jurisdictions.push(row);
            return row;
          }),
        },
      }),
    ),
  },
}));

import { TaxEngineDeepService } from "../services/tax-engine-deep.service";

describe("E12 · TaxEngineDeepService rate changes are versioned by effective date, never retroactive (G-15)", () => {
  let service: TaxEngineDeepService;

  beforeEach(() => {
    vi.clearAllMocks();
    jurisdictions = [
      {
        id: "jx-1",
        tenantId: "t1",
        name: "California Sales Tax",
        code: "US-CA",
        country: "US",
        state: "CA",
        county: null,
        taxType: "SALES",
        rate: 7.25,
        effectiveFrom: new Date("2025-01-01"),
        effectiveTo: null,
        description: null,
        isActive: true,
      },
    ];
    service = new TaxEngineDeepService();
  });

  it("preserves the rate that was in effect on a past date after a later rate change (changeRate)", async () => {
    await service.changeRate("t1", "jx-1", 8.5, "2026-06-01");

    const rateInJune2025 = await service.getRateAsOf(
      "t1",
      "US-CA",
      new Date("2025-06-01"),
    );
    expect(Number(rateInJune2025.rate)).toBe(7.25);

    const rateInJuly2026 = await service.getRateAsOf(
      "t1",
      "US-CA",
      new Date("2026-07-01"),
    );
    expect(Number(rateInJuly2026.rate)).toBe(8.5);
  });

  it("rejects a raw `rate` field passed to updateJurisdiction (TypeScript-level: rate is no longer part of the partial DTO)", () => {
    // Compile-time proof lives in the type signature itself — `rate` was
    // removed from updateJurisdiction's Partial<{...}> type. This test
    // documents the runtime contract that remains: updateJurisdiction
    // never writes a `rate` key even if a caller bypasses the type
    // (e.g. from an untyped controller boundary).
    const dto: any = { name: "Renamed", rate: 999 };
    return service.updateJurisdiction("t1", "jx-1", dto).then(() => {
      expect(jurisdictions[0].rate).toBe(7.25);
    });
  });
});
