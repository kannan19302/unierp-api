import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsService } from "./operations.service";

const database = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  backgroundJob: { groupBy: vi.fn() },
  setting: { findUnique: vi.fn() },
}));
vi.mock("@kannan19302/database", () => ({ prisma: database }));
vi.mock("@/common/idp-client", () => ({ idpClient: {} }));

describe("operations telemetry truthfulness", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reports only the measured database probe without invented percentiles", async () => {
    database.$executeRaw.mockResolvedValue(1);
    const services = await new OperationsService().getHealthServices();
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ service: "postgres-primary", status: "HEALTHY" });
    expect(services[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(services[0]).not.toHaveProperty("p95LatencyMs");
    expect(services[0]).not.toHaveProperty("errorRatePct");
  });

  it("reports a failed database probe as unhealthy", async () => {
    database.$executeRaw.mockRejectedValue(new Error("offline"));
    expect((await new OperationsService().getHealthServices())[0].status).toBe("UNHEALTHY");
  });

  it("does not turn a failed queue source into zero healthy queues", async () => {
    database.backgroundJob.groupBy.mockRejectedValue(new Error("offline"));
    const queues = await new OperationsService().getQueues();
    expect(queues.length).toBeGreaterThan(0);
    for (const queue of queues) {
      expect(queue.status).toBe("UNKNOWN");
      expect(queue.pending).toBeUndefined();
      expect(queue.total).toBeUndefined();
    }
  });

  it("does not claim persisted job records prove live worker health", async () => {
    database.backgroundJob.groupBy.mockResolvedValue([{ status: "ACTIVE", _count: { id: 2 } }]);
    const queues = await new OperationsService().getQueues();
    expect(queues[0]).toMatchObject({ processing: 2, total: 2, status: "UNKNOWN" });
  });

  it("does not advertise automation policies when none are configured", async () => {
    database.setting.findUnique.mockResolvedValue(null);
    expect(await new OperationsService().getAutomationRules("synthetic-tenant")).toEqual([]);
    expect(database.setting.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: "synthetic-tenant", key: "operations.automation_rules" } },
    });
  });
});
