/**
 * M37 exit criterion: "A retention schedule executes deletion on time
 * and certifies it consistently with DELETION_POLICY.md and C24."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let samples: any[];
let certificates: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    telemetrySample: {
      count: vi.fn(({ where }: any) => samples.filter((s) => new Date(s.observedAt) < where.observedAt.lt).length),
      deleteMany: vi.fn(({ where }: any) => {
        const toDelete = samples.filter((s) => new Date(s.observedAt) < where.observedAt.lt);
        samples = samples.filter((s) => new Date(s.observedAt) >= where.observedAt.lt);
        return { count: toDelete.length };
      }),
    },
    retentionCertificate: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("cert"), ...data };
        certificates.push(row);
        return row;
      }),
    },
  },
}));

import { RetentionScheduleService } from "./retention-schedule.service";

describe("M37 · retention schedule executes deletion on time and certifies it", () => {
  let retention: RetentionScheduleService;

  beforeEach(() => {
    vi.clearAllMocks();
    samples = [];
    certificates = [];
    retention = new RetentionScheduleService();
  });

  it("deletes only records PAST the retention window — ON TIME, not early and not late", async () => {
    const now = new Date("2026-08-11T00:00:00Z");
    const ninetyOneDaysAgo = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const eightyNineDaysAgo = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);

    samples.push(
      { id: "s-old", observedAt: ninetyOneDaysAgo }, // past the 90-day window -- must be deleted
      { id: "s-recent", observedAt: eightyNineDaysAgo }, // still within the window -- must survive
    );

    const cert = await retention.executeAndCertify("provider-telemetry-samples", now);

    expect(samples.map((s) => s.id)).toEqual(["s-recent"]); // exactly the recent one survives
    expect(cert.candidateCount).toBe(1);
    expect(cert.deletedCount).toBe(1);
  });

  it("CERTIFIES every run, even one that finds zero candidates -- 'it ran' is provable either way", async () => {
    const cert = await retention.executeAndCertify("provider-telemetry-samples", new Date("2026-08-11T00:00:00Z"));
    expect(certificates).toHaveLength(1);
    expect(cert.candidateCount).toBe(0);
    expect(cert.deletedCount).toBe(0);
  });

  it("an undeclared dataClass is refused explicitly, not silently no-op'd", async () => {
    await expect(retention.executeAndCertify("not-a-real-class")).rejects.toThrow(/No retention class/);
    expect(certificates).toHaveLength(0);
  });
});
