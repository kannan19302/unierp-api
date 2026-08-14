import { describe, it, expect } from "vitest";
import { SubscriptionMigrationService } from "../subscription-migration.service";

describe("SubscriptionMigrationService - Proration Logic", () => {
  let service: SubscriptionMigrationService;

  beforeEach(() => {
    service = new SubscriptionMigrationService();
  });

  describe("calculateProration", () => {
    it("should calculate correct proration for mid-cycle downgrade", () => {
      const periodStart = new Date("2026-01-01");
      const periodEnd = new Date("2026-01-31");
      const effectiveDate = new Date("2026-01-16"); // Mid-month

      const result = service.calculateProration(
        periodStart,
        periodEnd,
        effectiveDate,
        100, // current unit amount
        50,  // new unit amount
        1    // quantity
      );

      // 31 days total, 16 days used (Jan 1-16), 15 days remaining (Jan 17-31)
      expect(result.daysInPeriod).toBe(31);
      expect(result.daysUsed).toBe(16);
      expect(result.daysRemaining).toBe(15);

      // Credit: 100/31 * 15 = 48.39
      // Charge: 50/31 * 15 = 24.19
      expect(result.proratedCredit).toBe(48.39);
      expect(result.proratedCharge).toBe(24.19);
    });

    it("should calculate correct proration for upgrade", () => {
      const periodStart = new Date("2026-02-01");
      const periodEnd = new Date("2026-02-28");
      const effectiveDate = new Date("2026-02-15"); // Mid-month

      const result = service.calculateProration(
        periodStart,
        periodEnd,
        effectiveDate,
        50,  // current unit amount
        100, // new unit amount
        2    // quantity
      );

      // 28 days total, 15 days used (Feb 1-15), 13 days remaining (Feb 16-28)
      expect(result.daysInPeriod).toBe(28);
      expect(result.daysUsed).toBe(15);
      expect(result.daysRemaining).toBe(13);

      // Credit: 50/28 * 13 * 2 = 46.43
      // Charge: 100/28 * 13 * 2 = 92.86
      expect(result.proratedCredit).toBe(46.43);
      expect(result.proratedCharge).toBe(92.86);
    });

    it("should handle start of period (minimal credit, full charge)", () => {
      const periodStart = new Date("2026-01-01");
      const periodEnd = new Date("2026-01-31");
      const effectiveDate = new Date("2026-01-01"); // First day

      const result = service.calculateProration(
        periodStart,
        periodEnd,
        effectiveDate,
        100,
        50,
        1
      );

      expect(result.daysUsed).toBe(1);
      expect(result.daysRemaining).toBe(30);
      expect(result.proratedCredit).toBe(96.77); // 100/31 * 30
      expect(result.proratedCharge).toBe(48.39); // 50/31 * 30
    });

    it("should handle end of period (no credit, no charge for new plan)", () => {
      const periodStart = new Date("2026-01-01");
      const periodEnd = new Date("2026-01-31");
      const effectiveDate = new Date("2026-01-31"); // Last day

      const result = service.calculateProration(
        periodStart,
        periodEnd,
        effectiveDate,
        100,
        50,
        1
      );

      expect(result.daysUsed).toBe(31);
      expect(result.daysRemaining).toBe(0);
      expect(result.proratedCredit).toBe(0.00); // Used full day, no credit
      expect(result.proratedCharge).toBe(0.00); // No remaining days for new plan
    });

    it("should throw for effective date before period start", () => {
      const periodStart = new Date("2026-01-01");
      const periodEnd = new Date("2026-01-31");
      const effectiveDate = new Date("2025-12-31");

      expect(() =>
        service.calculateProration(
          periodStart,
          periodEnd,
          effectiveDate,
          100,
          50,
          1
        )
      ).toThrow("Effective date must be within current billing period");
    });

    it("should throw for effective date after period end", () => {
      const periodStart = new Date("2026-01-01");
      const periodEnd = new Date("2026-01-31");
      const effectiveDate = new Date("2026-02-01");

      expect(() =>
        service.calculateProration(
          periodStart,
          periodEnd,
          effectiveDate,
          100,
          50,
          1
        )
      ).toThrow("Effective date must be within current billing period");
    });

    it("should handle quantity correctly", () => {
      const periodStart = new Date("2026-01-01");
      const periodEnd = new Date("2026-01-31");
      const effectiveDate = new Date("2026-01-16");

      const result1 = service.calculateProration(
        periodStart,
        periodEnd,
        effectiveDate,
        100,
        50,
        1
      );

      const result3 = service.calculateProration(
        periodStart,
        periodEnd,
        effectiveDate,
        100,
        50,
        3
      );

      expect(result3.proratedCredit).toBeCloseTo(result1.proratedCredit * 3, 1);
      expect(result3.proratedCharge).toBeCloseTo(result1.proratedCharge * 3, 1);
    });

    it("should handle leap year February", () => {
      const periodStart = new Date("2024-02-01"); // Leap year
      const periodEnd = new Date("2024-02-29");
      const effectiveDate = new Date("2024-02-15");

      const result = service.calculateProration(
        periodStart,
        periodEnd,
        effectiveDate,
        100,
        50,
        1
      );

      expect(result.daysInPeriod).toBe(29);
      expect(result.daysUsed).toBe(15);
      expect(result.daysRemaining).toBe(14);
    });
  });

  describe("independent verification", () => {
    it("should match manual calculation for downgrade scenario", () => {
      // Scenario: $100/mo plan, downgrade to $50/mo on day 16 of 31-day month
      // Expected credit: (100/31) * 15 = 48.387 -> 48.39
      // Expected charge: (50/31) * 15 = 24.1935 -> 24.19
      const result = service.calculateProration(
        new Date("2026-01-01"),
        new Date("2026-01-31"),
        new Date("2026-01-16"),
        100,
        50,
        1
      );

      // Independent verification
      const daysTotal = 31;
      const daysUsed = 16;
      const daysRemaining = 15;
      const expectedCredit = Math.round((100 / daysTotal) * daysRemaining * 100) / 100;
      const expectedCharge = Math.round((50 / daysTotal) * daysRemaining * 100) / 100;

      expect(result.proratedCredit).toBe(expectedCredit);
      expect(result.proratedCharge).toBe(expectedCharge);
    });

    it("should match manual calculation for upgrade scenario", () => {
      // Scenario: $50/mo plan, upgrade to $100/mo on day 15 of 28-day month, qty=2
      // Expected credit: (50/28) * 13 * 2 = 46.428 -> 46.43
      // Expected charge: (100/28) * 13 * 2 = 92.857 -> 92.86
      const result = service.calculateProration(
        new Date("2026-02-01"),
        new Date("2026-02-28"),
        new Date("2026-02-15"),
        50,
        100,
        2
      );

      const daysTotal = 28;
      const daysUsed = 15;
      const daysRemaining = 13;
      const expectedCredit = Math.round((50 / daysTotal) * daysRemaining * 2 * 100) / 100;
      const expectedCharge = Math.round((100 / daysTotal) * daysRemaining * 2 * 100) / 100;

      expect(result.proratedCredit).toBe(expectedCredit);
      expect(result.proratedCharge).toBe(expectedCharge);
    });
  });
});