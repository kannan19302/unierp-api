import { describe, it, expect, vi, beforeEach } from "vitest";
import { LogisticsExecutionController } from "../logistics-execution.controller";

/**
 * L07 — proves the controller's routing behavior is unchanged after
 * extracting its Zod schemas to logistics-execution.schemas.ts (the
 * decomposition that brought this file from 401 to 308 lines). Every
 * handler must still delegate to the service with the exact tenant/user
 * context and body — a schema-extraction refactor that silently dropped
 * an argument or changed a route would fail these.
 */
describe("LogisticsExecutionController", () => {
  let service: any;
  let controller: LogisticsExecutionController;
  const req = { user: { tenantId: "t1", userId: "u1", email: "a@b.com", roles: [] } } as any;

  beforeEach(() => {
    service = {
      getTransportModes: vi.fn().mockResolvedValue([]),
      createTransportMode: vi.fn().mockResolvedValue({}),
      getCarrierRates: vi.fn().mockResolvedValue([]),
      createCarrierRate: vi.fn().mockResolvedValue({}),
      getLoadBuilds: vi.fn().mockResolvedValue([]),
      getLoadBuildById: vi.fn().mockResolvedValue({}),
      createLoadBuild: vi.fn().mockResolvedValue({}),
      updateLoadBuildStatus: vi.fn().mockResolvedValue({}),
      createTenderRequest: vi.fn().mockResolvedValue({}),
      getAppointments: vi.fn().mockResolvedValue([]),
      createAppointment: vi.fn().mockResolvedValue({}),
      updateAppointmentStatus: vi.fn().mockResolvedValue({}),
      createDeliveryConfirmation: vi.fn().mockResolvedValue({}),
      getDeliveryConfirmations: vi.fn().mockResolvedValue([]),
      rateShop: vi.fn().mockResolvedValue({}),
    };
    controller = new LogisticsExecutionController(service);
  });

  it("listTransportModes delegates to the service with the tenant id", () => {
    controller.listTransportModes(req);
    expect(service.getTransportModes).toHaveBeenCalledWith("t1");
  });

  it("createTransportMode delegates with tenant id and body", () => {
    const body = { code: "LTL", name: "Less Than Truckload" };
    controller.createTransportMode(req, body);
    expect(service.createTransportMode).toHaveBeenCalledWith("t1", body);
  });

  it("listCarrierRates delegates with the filter object built from query params", () => {
    controller.listCarrierRates(req, "carrier-1", "10001", "94105");
    expect(service.getCarrierRates).toHaveBeenCalledWith("t1", {
      carrierId: "carrier-1",
      originZip: "10001",
      destZip: "94105",
    });
  });

  it("getLoadBuild delegates with tenant id and load id", () => {
    controller.getLoadBuild(req, "load-1");
    expect(service.getLoadBuildById).toHaveBeenCalledWith("t1", "load-1");
  });

  it("createLoadBuild validates against the EXTRACTED schema and delegates with tenant/body/user", () => {
    const body = { loadType: "FTL", stops: [{ stopSequence: 1 }] };
    controller.createLoadBuild(req, body as any);
    expect(service.createLoadBuild).toHaveBeenCalledWith("t1", body, "u1");
  });

  it("updateLoadBuildStatus delegates with tenant id, load id, and new status", () => {
    controller.updateLoadBuildStatus(req, "load-1", { status: "IN_TRANSIT" });
    expect(service.updateLoadBuildStatus).toHaveBeenCalledWith("t1", "load-1", "IN_TRANSIT");
  });

  it("createTender delegates with tenant id, load id, and body", () => {
    const body = { carrierId: "c1" };
    controller.createTender(req, "load-1", body);
    expect(service.createTenderRequest).toHaveBeenCalledWith("t1", "load-1", body);
  });

  it("listAppointments delegates with the full filter object including warehouseId", () => {
    controller.listAppointments(req, "1", "20", "SCHEDULED", "wh-1");
    expect(service.getAppointments).toHaveBeenCalledWith("t1", {
      page: 1,
      limit: 20,
      status: "SCHEDULED",
      warehouseId: "wh-1",
    });
  });

  it("createAppointment validates against the EXTRACTED schema and delegates with tenant/body/user", () => {
    const body = { appointmentType: "PICKUP", scheduledStart: "2026-01-01T00:00:00Z" };
    controller.createAppointment(req, body as any);
    expect(service.createAppointment).toHaveBeenCalledWith("t1", body, "u1");
  });

  it("updateAppointmentStatus delegates with tenant id, appointment id, and new status", () => {
    controller.updateAppointmentStatus(req, "appt-1", { status: "CHECKED_IN" });
    expect(service.updateAppointmentStatus).toHaveBeenCalledWith("t1", "appt-1", "CHECKED_IN");
  });

  it("createPod validates against the EXTRACTED schema and delegates with tenant/body/user", () => {
    const body = { lines: [{ expectedQty: 10, deliveredQty: 10 }] };
    controller.createPod(req, body as any);
    expect(service.createDeliveryConfirmation).toHaveBeenCalledWith("t1", body, "u1");
  });

  it("listPods delegates with the full filter object", () => {
    controller.listPods(req, "ship-1", "1", "20");
    expect(service.getDeliveryConfirmations).toHaveBeenCalledWith("t1", {
      shipmentId: "ship-1",
      page: 1,
      limit: 20,
    });
  });

  it("rateShop delegates with numeric weight/pallets parsed from query strings", () => {
    controller.rateShop(req, "10001", "94105", "500", "3");
    expect(service.rateShop).toHaveBeenCalledWith("t1", {
      originZip: "10001",
      destZip: "94105",
      weight: 500,
      pallets: 3,
    });
  });
});
