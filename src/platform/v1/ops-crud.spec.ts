import { describe, it, expect, vi } from "vitest";
import { RunbookService } from "./runbook.service";
import { ReleaseControlService } from "./release-control.service";
import { IncidentService } from "./incident.service";

describe("Platform Operations (PCC-01) Backend Services", () => {
  describe("RunbookService", () => {
    it("lists default runbooks when DB returns empty", async () => {
      const service = new RunbookService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const list = await service.listRunbooks();
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty("name");
      expect(list[0]).toHaveProperty("status");
    });

    it("can retrieve a single runbook by ID and delete it", async () => {
      const service = new RunbookService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const rb = await service.getRunbook("rb-drain-node");
      expect(rb.id).toBe("rb-drain-node");
      expect(rb.status).toBe("PUBLISHED");

      const del = await service.deleteRunbook("rb-drain-node");
      expect(del.deleted).toBe(true);
    });
  });

  describe("ReleaseControlService", () => {
    it("returns pipeline stages with valid canary weight and healthy status", async () => {
      const mockAudit = { record: vi.fn() };
      const service = new ReleaseControlService(mockAudit as any);
      const pipeline = await service.getPipelineStages();
      expect(pipeline.stages.length).toBe(4);
      expect(pipeline.activeCanaryPercent).toBe(10);
      expect(pipeline.stages.map((s) => s.stage)).toEqual(["dev", "staging", "canary", "production"]);
    });

    it("adjusts canary traffic weight and records audit log", async () => {
      const mockAudit = { record: vi.fn() };
      const service = new ReleaseControlService(mockAudit as any);
      const res = await service.setCanaryTraffic(25, "admin@unierp.com");
      expect(res.activeCanaryPercent).toBe(25);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "release.canary_traffic_adjusted",
          details: expect.objectContaining({ previousWeight: 10, newWeight: 25 }),
        }),
      );
    });
  });

  describe("IncidentService", () => {
    it("lists incidents with filtering support", async () => {
      const service = new IncidentService({} as any);
      const all = await service.listIncidents();
      expect(all.length).toBeGreaterThan(0);

      const criticalOnly = await service.listIncidents({ severity: "CRITICAL" });
      expect(criticalOnly.every((i) => i.severity === "CRITICAL")).toBe(true);
    });

    it("escalates severity and adds entry to event timeline", async () => {
      const service = new IncidentService({} as any);
      const escalated = await service.escalateSeverity("inc-02", "CRITICAL", "admin@unierp.com", "Secondary replica also hung");
      expect(escalated.severity).toBe("CRITICAL");
      const lastEvent = escalated.timeline[escalated.timeline.length - 1];
      expect(lastEvent.event).toContain("Severity escalated");
      expect(lastEvent.actor).toBe("admin@unierp.com");
    });

    it("resolves incident with root cause and corrective action", async () => {
      const service = new IncidentService({} as any);
      const resolved = await service.resolveIncident(
        "inc-01",
        "Connection leak in connection pool",
        "Restarted ingress proxies and raised pool limit",
        "test.agent@unierp.com",
      );
      expect(resolved.status).toBe("RESOLVED");
      expect(resolved.rootCause).toBe("Connection leak in connection pool");
      expect(resolved.resolvedBy).toBe("test.agent@unierp.com");
    });
  });
});
