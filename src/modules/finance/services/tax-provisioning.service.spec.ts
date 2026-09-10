import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@kannan19302/database/prisma";

const db = vi.hoisted(() => ({
  account: { findFirst: vi.fn() },
  taxProvisionRun: { findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
  taxProvisionDetail: { count: vi.fn(), findFirst: vi.fn() }, deferredTaxSchedule: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
  uncertainTaxPosition: { count: vi.fn() }, valuationAllowanceAssessment: { count: vi.fn() },
}));
vi.mock("@kannan19302/database", () => ({ prisma: db }));
vi.mock("../../../common/idp-client", () => ({ idpClient: {} }));
import { TaxProvisioningService } from "./tax-provisioning.service";

describe("TaxProvisioningService invariants", () => {
  const service = new TaxProvisioningService();
  beforeEach(() => vi.resetAllMocks());

  it("refuses to delete a non-draft provision run", async () => {
    db.taxProvisionRun.findFirst.mockResolvedValue({ id: "run-1", tenantId: "tenant-1", status: "REVIEWED" });
    await expect(service.deleteProvisionRun("tenant-1", "run-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(db.taxProvisionRun.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a draft that has dependent tax records", async () => {
    db.taxProvisionRun.findFirst.mockResolvedValue({ id: "run-1", tenantId: "tenant-1", status: "DRAFT" });
    db.taxProvisionDetail.count.mockResolvedValue(1);
    db.deferredTaxSchedule.count.mockResolvedValue(0);
    db.uncertainTaxPosition.count.mockResolvedValue(0);
    db.valuationAllowanceAssessment.count.mockResolvedValue(0);
    await expect(service.deleteProvisionRun("tenant-1", "run-1")).rejects.toThrow("dependent records");
  });

  it("recomputes the schedule named by the item route", async () => {
    db.deferredTaxSchedule.findFirst.mockResolvedValue({ id: "schedule-1", tenantId: "tenant-1", temporaryDifference: new Prisma.Decimal(-1000), taxRate: new Prisma.Decimal(21) });
    db.deferredTaxSchedule.update.mockResolvedValue({ id: "schedule-1" });
    await service.computeDeferredTaxes("tenant-1", "schedule-1");
    expect(db.deferredTaxSchedule.findFirst).toHaveBeenCalledWith({ where: { id: "schedule-1", tenantId: "tenant-1" } });
    expect(db.deferredTaxSchedule.update).toHaveBeenCalledWith({ where: { id: "schedule-1" }, data: { deferredTaxAsset: new Prisma.Decimal(210), deferredTaxLiability: null } });
  });

  it("refuses to update details of a posted provision run", async () => {
    db.taxProvisionDetail.findFirst = vi.fn().mockResolvedValue({ id: "detail-1", tenantId: "tenant-1", runId: "run-posted" });
    db.taxProvisionRun.findFirst.mockResolvedValue({ id: "run-posted", tenantId: "tenant-1", status: "POSTED" });
    await expect(service.updateProvisionDetail("tenant-1", "detail-1", { taxableIncome: 50000 })).rejects.toThrow("immutable");
  });

  it("posts double-entry GL journal when posting provision run", async () => {
    const mockGlService = {
      createJournal: vi.fn().mockResolvedValue({ id: "gl-tax-1" }),
    };
    const svcWithGl = new TaxProvisioningService(mockGlService as never);
    db.account.findFirst.mockResolvedValueOnce({ id: "acc-exp-1" });
    db.account.findFirst.mockResolvedValueOnce({ id: "acc-liab-1" });
    db.taxProvisionRun.findFirst.mockResolvedValue({
      id: "run-1",
      tenantId: "tenant-1",
      status: "REVIEWED",
      period: "2026-Q1",
      fiscalYear: 2026,
      totalTaxProvision: new Prisma.Decimal(15000),
      currentTaxExpense: new Prisma.Decimal(10000),
      deferredTaxExpense: new Prisma.Decimal(5000),
    });
    db.taxProvisionRun.update = vi.fn().mockResolvedValue({
      id: "run-1",
      status: "POSTED",
      notes: "GL Journal: gl-tax-1",
    });

    const result = await svcWithGl.postProvisionRun("tenant-1", "run-1");
    expect(mockGlService.createJournal).toHaveBeenCalledWith("tenant-1", "tenant-1", expect.objectContaining({
      entryNumber: expect.stringContaining("TAX-PROV-2026"),
      notes: expect.stringContaining("Tax provision GL posting"),
      entries: expect.arrayContaining([
        expect.objectContaining({ accountId: "acc-exp-1", debit: 15000, credit: 0 }),
        expect.objectContaining({ accountId: "acc-liab-1", debit: 0, credit: 15000 }),
      ]),
    }));
    expect(result.status).toBe("POSTED");
  });
});

