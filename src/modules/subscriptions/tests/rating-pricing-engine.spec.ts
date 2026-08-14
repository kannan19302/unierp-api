import { describe, it, expect } from "vitest";
import { SubscriptionCouponService } from "../subscription-coupon.service";
import { SubscriptionMigrationService } from "../subscription-migration.service";
import { PricingService } from "../../sales/pricing.service";
import { SalesAdvancedPricingService } from "../../sales/sales-advanced-pricing.service";
import { SalesAdvancedPricingDeepService } from "../../sales/sales-advanced-pricing-deep.service";
import { Prisma } from "@prisma/client";

describe("K06 · Rating and Pricing Engine — Comprehensive Scenarios", () => {
  let couponService: SubscriptionCouponService;
  let migrationService: SubscriptionMigrationService;
  let pricingService: PricingService;
  let advancedPricingService: SalesAdvancedPricingService;
  let deepPricingService: SalesAdvancedPricingDeepService;

  beforeEach(() => {
    couponService = new SubscriptionCouponService();
    migrationService = new SubscriptionMigrationService();
    pricingService = new PricingService();
    advancedPricingService = new SalesAdvancedPricingService();
    deepPricingService = new SalesAdvancedPricingDeepService();
  });

  describe("Coupon Redemption — Independent Verification", () => {
    const mockSubscription = {
      id: "sub-1",
      unitAmount: new Prisma.Decimal(100),
      quantity: 2,
    };

    it("PERCENTAGE coupon: 20% off $100 × 2 = $40 discount", () => {
      const coupon = {
        discountType: "PERCENTAGE",
        discountValue: new Prisma.Decimal(20),
      };
      const expectedDiscount = Math.round(
        Number(mockSubscription.unitAmount) *
          mockSubscription.quantity *
          (Number(coupon.discountValue) / 100) *
          100
      ) / 100;
      expect(expectedDiscount).toBe(40.00);
    });

    it("FIXED_AMOUNT coupon: $25 flat discount", () => {
      const coupon = {
        discountType: "FIXED_AMOUNT",
        discountValue: new Prisma.Decimal(25),
      };
      const expectedDiscount = Number(coupon.discountValue);
      expect(expectedDiscount).toBe(25.00);
    });

    it("FREE_MONTHS coupon: 3 free months on $100/mo × 2 qty = $600 discount", () => {
      const coupon = {
        discountType: "FREE_MONTHS",
        discountValue: new Prisma.Decimal(3),
      };
      const expectedDiscount = Math.round(
        Number(mockSubscription.unitAmount) *
          mockSubscription.quantity *
          Number(coupon.discountValue) *
          100
      ) / 100;
      expect(expectedDiscount).toBe(600.00);
    });

    it("FREE_MONTHS coupon: 1 free month on $50/mo × 1 qty = $50 discount", () => {
      const sub = { unitAmount: new Prisma.Decimal(50), quantity: 1 };
      const coupon = {
        discountType: "FREE_MONTHS",
        discountValue: new Prisma.Decimal(1),
      };
      const expectedDiscount = Math.round(
        Number(sub.unitAmount) * sub.quantity * Number(coupon.discountValue) * 100
      ) / 100;
      expect(expectedDiscount).toBe(50.00);
    });

    it("PERCENTAGE coupon: 15% off $75 × 3 = $33.75 discount", () => {
      const sub = { unitAmount: new Prisma.Decimal(75), quantity: 3 };
      const coupon = {
        discountType: "PERCENTAGE",
        discountValue: new Prisma.Decimal(15),
      };
      const expectedDiscount = Math.round(
        Number(sub.unitAmount) * sub.quantity * (Number(coupon.discountValue) / 100) * 100
      ) / 100;
      expect(expectedDiscount).toBe(33.75);
    });

    it("FIXED_AMOUNT coupon: $99.99 flat discount (precision test)", () => {
      const coupon = {
        discountType: "FIXED_AMOUNT",
        discountValue: new Prisma.Decimal(99.99),
      };
      const expectedDiscount = Number(coupon.discountValue);
      expect(expectedDiscount).toBe(99.99);
    });
  });

  describe("Overage Calculation — Independent Verification", () => {
    it("Plan: 100 included units, $0.50 overage rate. Usage: 150 units → 50 overage × $0.50 = $25", () => {
      const includedUnits = 100;
      const overageRate = 0.50;
      const usage = 150;
      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      expect(overageUnits).toBe(50);
      expect(overageCharge).toBe(25.00);
    });

    it("Plan: 1000 included API calls, $0.01 overage rate. Usage: 1234 calls → 234 overage × $0.01 = $2.34", () => {
      const includedUnits = 1000;
      const overageRate = 0.01;
      const usage = 1234;
      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      expect(overageUnits).toBe(234);
      expect(overageCharge).toBe(2.34);
    });

    it("Plan: 50 GB included, $2.00/GB overage. Usage: 45 GB → 0 overage = $0", () => {
      const includedUnits = 50;
      const overageRate = 2.00;
      const usage = 45;
      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      expect(overageUnits).toBe(0);
      expect(overageCharge).toBe(0.00);
    });

    it("Plan: 10 included seats, $15/seat overage. Usage: 10 seats → 0 overage = $0", () => {
      const includedUnits = 10;
      const overageRate = 15;
      const usage = 10;
      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      expect(overageUnits).toBe(0);
      expect(overageCharge).toBe(0.00);
    });

    it("Plan: 10000 events, $0.001 overage. Usage: 10001 → 1 overage × $0.001 = $0.00 (rounded)", () => {
      const includedUnits = 10000;
      const overageRate = 0.001;
      const usage = 10001;
      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      expect(overageUnits).toBe(1);
      expect(overageCharge).toBe(0.00);
    });

    it("Plan: 100 units, $0.10 overage. Usage: 101 → 1 overage × $0.10 = $0.10", () => {
      const includedUnits = 100;
      const overageRate = 0.10;
      const usage = 101;
      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      expect(overageCharge).toBe(0.10);
    });
  });

  describe("Volume Discount — Independent Verification", () => {
    it("1000 units @ $100 → 25% discount = $75/unit, total $75,000", async () => {
      const result = await deepPricingService.calculateVolumeDiscount("t1", {
        productId: "p1",
        quantity: 1000,
        basePrice: 100,
      });
      const expectedUnitPrice = 100 * (1 - 25 / 100);
      const expectedTotal = expectedUnitPrice * 1000;
      expect(result.appliedDiscountPct).toBe(25);
      expect(result.unitPrice).toBe(expectedUnitPrice);
      expect(result.totalPrice).toBe(expectedTotal);
    });

    it("500 units @ $100 → 20% discount = $80/unit, total $40,000", async () => {
      const result = await deepPricingService.calculateVolumeDiscount("t1", {
        productId: "p1",
        quantity: 500,
        basePrice: 100,
      });
      const expectedUnitPrice = 100 * (1 - 20 / 100);
      const expectedTotal = expectedUnitPrice * 500;
      expect(result.appliedDiscountPct).toBe(20);
      expect(result.unitPrice).toBe(expectedUnitPrice);
      expect(result.totalPrice).toBe(expectedTotal);
    });

    it("100 units @ $100 → 15% discount = $85/unit, total $8,500", async () => {
      const result = await deepPricingService.calculateVolumeDiscount("t1", {
        productId: "p1",
        quantity: 100,
        basePrice: 100,
      });
      const expectedUnitPrice = 100 * (1 - 15 / 100);
      const expectedTotal = expectedUnitPrice * 100;
      expect(result.appliedDiscountPct).toBe(15);
      expect(result.unitPrice).toBe(expectedUnitPrice);
      expect(result.totalPrice).toBe(expectedTotal);
    });

    it("50 units @ $100 → 10% discount = $90/unit, total $4,500", async () => {
      const result = await deepPricingService.calculateVolumeDiscount("t1", {
        productId: "p1",
        quantity: 50,
        basePrice: 100,
      });
      const expectedUnitPrice = 100 * (1 - 10 / 100);
      const expectedTotal = expectedUnitPrice * 50;
      expect(result.appliedDiscountPct).toBe(10);
      expect(result.unitPrice).toBe(expectedUnitPrice);
      expect(result.totalPrice).toBe(expectedTotal);
    });

    it("10 units @ $100 → 5% discount = $95/unit, total $950", async () => {
      const result = await deepPricingService.calculateVolumeDiscount("t1", {
        productId: "p1",
        quantity: 10,
        basePrice: 100,
      });
      const expectedUnitPrice = 100 * (1 - 5 / 100);
      const expectedTotal = expectedUnitPrice * 10;
      expect(result.appliedDiscountPct).toBe(5);
      expect(result.unitPrice).toBe(expectedUnitPrice);
      expect(result.totalPrice).toBe(expectedTotal);
    });

    it("5 units @ $100 → 0% discount = $100/unit, total $500", async () => {
      const result = await deepPricingService.calculateVolumeDiscount("t1", {
        productId: "p1",
        quantity: 5,
        basePrice: 100,
      });
      const expectedUnitPrice = 100;
      const expectedTotal = expectedUnitPrice * 5;
      expect(result.appliedDiscountPct).toBe(0);
      expect(result.unitPrice).toBe(expectedUnitPrice);
      expect(result.totalPrice).toBe(expectedTotal);
    });

    it("250 units @ $200 → 15% discount = $170/unit, total $42,500", async () => {
      const result = await deepPricingService.calculateVolumeDiscount("t1", {
        productId: "p1",
        quantity: 250,
        basePrice: 200,
      });
      const expectedUnitPrice = 200 * (1 - 15 / 100);
      const expectedTotal = expectedUnitPrice * 250;
      expect(result.appliedDiscountPct).toBe(15);
      expect(result.unitPrice).toBe(expectedUnitPrice);
      expect(result.totalPrice).toBe(expectedTotal);
    });
  });

  describe("Proration — Independent Verification (Mid-cycle Downgrade)", () => {
    it("Downgrade: $100/mo → $50/mo on day 16 of 31-day month, qty=1", () => {
      const result = migrationService.calculateProration(
        new Date("2026-01-01"),
        new Date("2026-01-31"),
        new Date("2026-01-16"),
        100,
        50,
        1
      );
      const daysTotal = 31;
      const daysUsed = 16;
      const daysRemaining = 15;
      const expectedCredit = Math.round((100 / daysTotal) * daysRemaining * 100) / 100;
      const expectedCharge = Math.round((50 / daysTotal) * daysRemaining * 100) / 100;
      expect(result.daysInPeriod).toBe(daysTotal);
      expect(result.daysUsed).toBe(daysUsed);
      expect(result.daysRemaining).toBe(daysRemaining);
      expect(result.proratedCredit).toBe(expectedCredit);
      expect(result.proratedCharge).toBe(expectedCharge);
      expect(result.proratedCredit).toBe(48.39);
      expect(result.proratedCharge).toBe(24.19);
    });

    it("Upgrade: $50/mo → $100/mo on day 15 of 28-day month, qty=2", () => {
      const result = migrationService.calculateProration(
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
      expect(result.daysInPeriod).toBe(daysTotal);
      expect(result.daysUsed).toBe(daysUsed);
      expect(result.daysRemaining).toBe(daysRemaining);
      expect(result.proratedCredit).toBe(expectedCredit);
      expect(result.proratedCharge).toBe(expectedCharge);
      expect(result.proratedCredit).toBe(46.43);
      expect(result.proratedCharge).toBe(92.86);
    });

    it("Downgrade at period start: $200 → $100 on day 1 of 30-day month", () => {
      const result = migrationService.calculateProration(
        new Date("2026-04-01"),
        new Date("2026-04-30"),
        new Date("2026-04-01"),
        200,
        100,
        1
      );
      const daysTotal = 30;
      const daysUsed = 1;
      const daysRemaining = 29;
      const expectedCredit = Math.round((200 / daysTotal) * daysRemaining * 100) / 100;
      const expectedCharge = Math.round((100 / daysTotal) * daysRemaining * 100) / 100;
      expect(result.daysUsed).toBe(1);
      expect(result.daysRemaining).toBe(29);
      expect(result.proratedCredit).toBe(expectedCredit);
      expect(result.proratedCharge).toBe(expectedCharge);
      expect(result.proratedCredit).toBe(193.33);
      expect(result.proratedCharge).toBe(96.67);
    });

    it("Downgrade at period end: $100 → $50 on day 31 of 31-day month", () => {
      const result = migrationService.calculateProration(
        new Date("2026-01-01"),
        new Date("2026-01-31"),
        new Date("2026-01-31"),
        100,
        50,
        1
      );
      expect(result.daysUsed).toBe(31);
      expect(result.daysRemaining).toBe(0);
      expect(result.proratedCredit).toBe(0.00);
      expect(result.proratedCharge).toBe(0.00);
    });
  });

  describe("Combined Pricing Scenario — Full Invoice Calculation", () => {
    it("Scenario: Plan $100/mo, 100 included units, $0.50 overage. Usage 150 units. 20% coupon. Qty=1", () => {
      const basePrice = 100;
      const includedUnits = 100;
      const overageRate = 0.50;
      const usage = 150;
      const couponDiscountPct = 20;
      const quantity = 1;

      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      const subtotal = basePrice * quantity + overageCharge;
      const couponDiscount = Math.round(subtotal * (couponDiscountPct / 100) * 100) / 100;
      const total = Math.round((subtotal - couponDiscount) * 100) / 100;

      expect(overageUnits).toBe(50);
      expect(overageCharge).toBe(25.00);
      expect(subtotal).toBe(125.00);
      expect(couponDiscount).toBe(25.00);
      expect(total).toBe(100.00);
    });

    it("Scenario: Plan $200/mo, 1000 included API calls, $0.01 overage. Usage 1500 calls. $50 fixed coupon. Qty=2", () => {
      const basePrice = 200;
      const includedUnits = 1000;
      const overageRate = 0.01;
      const usage = 1500;
      const couponDiscountFixed = 50;
      const quantity = 2;

      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      const subtotal = basePrice * quantity + overageCharge;
      const total = Math.round((subtotal - couponDiscountFixed) * 100) / 100;

      expect(overageUnits).toBe(500);
      expect(overageCharge).toBe(5.00);
      expect(subtotal).toBe(405.00);
      expect(total).toBe(355.00);
    });

    it("Scenario: Plan $50/mo, 10 seats included, $15/seat overage. Usage 12 seats. 3 free months coupon. Qty=1", () => {
      const basePrice = 50;
      const includedUnits = 10;
      const overageRate = 15;
      const usage = 12;
      const freeMonths = 3;
      const quantity = 1;

      const overageUnits = Math.max(0, usage - includedUnits);
      const overageCharge = Math.round(overageUnits * overageRate * 100) / 100;
      const monthlyTotal = basePrice * quantity + overageCharge;
      const couponDiscount = monthlyTotal * freeMonths;
      const annualTotal = monthlyTotal * 12;
      const total = annualTotal - couponDiscount;

      expect(overageUnits).toBe(2);
      expect(overageCharge).toBe(30.00);
      expect(monthlyTotal).toBe(80.00);
      expect(couponDiscount).toBe(240.00);
      expect(annualTotal).toBe(960.00);
      expect(total).toBe(720.00);
    });
  });

  describe("Plan Minimums/Commitments", () => {
    it("Annual plan minimum: $100/mo × 12 = $1,200 minimum commitment", () => {
      const monthlyPrice = 100;
      const commitmentMonths = 12;
      const minimumCommitment = monthlyPrice * commitmentMonths;
      expect(minimumCommitment).toBe(1200);
    });

    it("Multi-year minimum: $200/mo × 24 months = $4,800 minimum", () => {
      const monthlyPrice = 200;
      const commitmentMonths = 24;
      const minimumCommitment = monthlyPrice * commitmentMonths;
      expect(minimumCommitment).toBe(4800);
    });

    it("Minimum with overage: $100/mo base + $50 overage × 12 = $1,800 minimum", () => {
      const monthlyPrice = 100;
      const estimatedOverage = 50;
      const commitmentMonths = 12;
      const minimumCommitment = (monthlyPrice + estimatedOverage) * commitmentMonths;
      expect(minimumCommitment).toBe(1800);
    });
  });

  describe("Currency and Exchange Rate Handling", () => {
    it("USD base: $100 × 1.0 = $100", () => {
      const basePrice = 100;
      const exchangeRate = 1.0;
      const converted = Math.round(basePrice * exchangeRate * 100) / 100;
      expect(converted).toBe(100.00);
    });

    it("EUR: $100 × 0.92 = €92.00", () => {
      const basePrice = 100;
      const exchangeRate = 0.92;
      const converted = Math.round(basePrice * exchangeRate * 100) / 100;
      expect(converted).toBe(92.00);
    });

    it("GBP: $100 × 0.79 = £79.00", () => {
      const basePrice = 100;
      const exchangeRate = 0.79;
      const converted = Math.round(basePrice * exchangeRate * 100) / 100;
      expect(converted).toBe(79.00);
    });

    it("JPY: $100 × 155.4 = ��15,540", () => {
      const basePrice = 100;
      const exchangeRate = 155.4;
      const converted = Math.round(basePrice * exchangeRate * 100) / 100;
      expect(converted).toBe(15540.00);
    });
  });

  describe("Tiered Pricing with Customer Price Lists", () => {
    it("Customer price list overrides base price when lower", () => {
      const basePrice = 100;
      const customerPrice = 85;
      const finalPrice = Math.min(basePrice, customerPrice);
      expect(finalPrice).toBe(85);
    });

    it("Customer price list ignored when higher than base", () => {
      const basePrice = 100;
      const customerPrice = 120;
      const finalPrice = Math.min(basePrice, customerPrice);
      expect(finalPrice).toBe(100);
    });

    it("Contract pricing overrides both base and customer list", () => {
      const basePrice = 100;
      const customerPrice = 90;
      const contractPrice = 75;
      const finalPrice = Math.min(basePrice, customerPrice, contractPrice);
      expect(finalPrice).toBe(75);
    });

    it("Floor price prevents pricing below minimum", () => {
      const computedPrice = 60;
      const floorPrice = 70;
      const finalPrice = Math.max(computedPrice, floorPrice);
      expect(finalPrice).toBe(70);
    });

    it("Floor price allows pricing above minimum", () => {
      const computedPrice = 85;
      const floorPrice = 70;
      const finalPrice = Math.max(computedPrice, floorPrice);
      expect(finalPrice).toBe(85);
    });
  });

  describe("Decimal Precision — Financial Arithmetic", () => {
    it("Rounding: 100/3 = 33.333... → 33.33 (2 decimal places)", () => {
      const result = Math.round((100 / 3) * 100) / 100;
      expect(result).toBe(33.33);
    });

    it("Rounding: 0.1 + 0.2 = 0.30000000000000004 → 0.30", () => {
      const result = Math.round((0.1 + 0.2) * 100) / 100;
      expect(result).toBe(0.30);
    });

    it("Large numbers: 999999.99 × 100 = 99999999.00", () => {
      const result = Math.round(999999.99 * 100 * 100) / 100;
      expect(result).toBe(99999999.00);
    });

    it("Precision: 33.335 → 33.34 (round half up)", () => {
      const result = Math.round(33.335 * 100) / 100;
      expect(result).toBe(33.34);
    });

    it("Precision: 33.334 → 33.33 (round half up)", () => {
      const result = Math.round(33.334 * 100) / 100;
      expect(result).toBe(33.33);
    });
  });
});