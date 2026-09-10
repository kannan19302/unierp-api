import { describe, expect, it, vi } from "vitest";
import { TaxProvisioningController } from "./tax-provisioning.controller";

const request = { user: { tenantId: "tenant-1", userId: "user-1" } } as never;

describe("TaxProvisioningController", () => {
  it("passes the contract runId to provision-detail creation", async () => {
    const service = { createProvisionDetail: vi.fn().mockResolvedValue({ id: "detail-1" }) };
    const controller = new TaxProvisioningController(service as never);
    const dto = { runId: "run-1", jurisdiction: "US", taxableIncome: 1000, taxRate: 21 };
    await controller.createProvisionDetail(request, dto);
    expect(service.createProvisionDetail).toHaveBeenCalledWith("tenant-1", "run-1", dto);
  });

  it("passes the contract runId to every child aggregate creator", async () => {
    const service = {
      createDeferredTaxSchedule: vi.fn(), createUncertainTaxPosition: vi.fn(), createValuationAllowance: vi.fn(),
    };
    const controller = new TaxProvisioningController(service as never);
    await controller.createDeferredTaxSchedule(request, { runId: "run-1" });
    await controller.createUncertainTaxPosition(request, { runId: "run-2" });
    await controller.createValuationAllowance(request, { runId: "run-3" });
    expect(service.createDeferredTaxSchedule).toHaveBeenCalledWith("tenant-1", "run-1", { runId: "run-1" });
    expect(service.createUncertainTaxPosition).toHaveBeenCalledWith("tenant-1", "run-2", { runId: "run-2" });
    expect(service.createValuationAllowance).toHaveBeenCalledWith("tenant-1", "run-3", { runId: "run-3" });
  });

  it("uses the authenticated reviewer for valuation assessment", async () => {
    const service = { assessValuationAllowance: vi.fn() };
    const controller = new TaxProvisioningController(service as never);
    await controller.assessValuationAllowance(request, "allowance-1");
    expect(service.assessValuationAllowance).toHaveBeenCalledWith("tenant-1", "allowance-1", "user-1");
  });
});
