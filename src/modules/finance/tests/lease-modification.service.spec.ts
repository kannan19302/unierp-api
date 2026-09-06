import { describe, it, expect, vi, beforeEach } from "vitest";
import { LeaseAccountingService } from "../services/lease-accounting.service";
import { BadRequestException } from "@nestjs/common";

vi.mock("@kannan19302/database/prisma", () => ({
  Prisma: {
    Decimal: class Decimal {
      value: number;
      constructor(value: unknown) {
        this.value = value instanceof Decimal ? value.value : Number(value);
      }
      valueOf() {
        return this.value;
      }
      toString() {
        return String(this.value);
      }
    },
  },
}));

vi.mock("@kannan19302/database", () => ({
  prisma: {
    financeLease: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    leaseSchedule: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    journal: {
      create: vi.fn(),
    },
    journalEntry: {
      createMany: vi.fn(),
    },
  },
}));

import { prisma } from "@kannan19302/database";

describe("LeaseAccountingService - Remeasurement & Modification", () => {
  let service: LeaseAccountingService;
  const mockEvents = { emit: vi.fn() } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LeaseAccountingService(mockEvents);
  });

  it("throws BadRequestException if lease is not ACTIVE", async () => {
    vi.mocked(prisma.financeLease.findFirst).mockResolvedValue({
      id: "lse-1",
      tenantId: "t1",
      status: "TERMINATED",
    } as any);

    await expect(
      service.remeasureLease("t1", "lse-1", {
        newEndDate: "2028-12-31",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws BadRequestException if new end date is before effective date", async () => {
    vi.mocked(prisma.financeLease.findFirst).mockResolvedValue({
      id: "lse-1",
      tenantId: "t1",
      status: "ACTIVE",
      endDate: new Date("2025-01-01"),
    } as any);

    await expect(
      service.remeasureLease("t1", "lse-1", {
        effectiveDate: "2026-06-01",
        newEndDate: "2026-01-01",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("successfully remeasures lease with liability increase and posts balanced GL journal", async () => {
    const originalLease = {
      id: "lse-1",
      tenantId: "t1",
      orgId: "org-1",
      leaseRef: "LSE-OFFICE-HQ",
      status: "ACTIVE",
      carryingAmount: 120000,
      presentValue: 120000,
      interestRate: 5.0,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2026-12-31"),
    };

    vi.mocked(prisma.financeLease.findFirst).mockResolvedValue(originalLease as any);
    vi.mocked(prisma.leaseSchedule.deleteMany).mockResolvedValue({ count: 12 } as any);
    vi.mocked(prisma.leaseSchedule.createMany).mockResolvedValue({ count: 24 } as any);
    vi.mocked(prisma.journal.create).mockResolvedValue({ id: "jrn-lse-mod-1" } as any);
    vi.mocked(prisma.journalEntry.createMany).mockResolvedValue({ count: 2 } as any);
    vi.mocked(prisma.financeLease.update).mockResolvedValue({
      ...originalLease,
      carryingAmount: 180000,
      presentValue: 180000,
      endDate: new Date("2028-12-31"),
    } as any);

    const result = await service.remeasureLease("t1", "lse-1", {
      effectiveDate: "2026-01-01",
      newEndDate: "2028-12-31",
      newPresentValue: 180000,
      reason: "2-year office lease extension with IBR update",
    });

    expect(result.oldLiability).toBe(120000);
    expect(result.newLiability).toBe(180000);
    expect(result.liabilityAdjustment).toBe(60000);
    expect(result.rouAdjustment).toBe(60000);
    expect(result.glJournalId).toBe("jrn-lse-mod-1");

    // Verification of balanced journal entries creation:
    expect(prisma.journalEntry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          accountId: "acc-rou-asset",
          debit: expect.anything(),
        }),
        expect.objectContaining({
          accountId: "acc-lease-liability",
          credit: expect.anything(),
        }),
      ]),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith(
      "finance.lease.remeasured",
      expect.objectContaining({ leaseId: "lse-1", adjustment: 60000 }),
    );
  });
});
