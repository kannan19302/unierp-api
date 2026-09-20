import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlatformIntegrationOperationsController } from "./integration-operations.controller";
import { PlatformIntegrationOperationsService, FieldMappingRule } from "./integration-operations.service";
import { BadRequestException, NotFoundException } from "@nestjs/common";

describe("Platform Integration & Connector Operations (PCC-20)", () => {
  let controller: PlatformIntegrationOperationsController;
  let service: PlatformIntegrationOperationsService;

  const mockAuditService = {
    record: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlatformIntegrationOperationsService(mockAuditService as any);
    controller = new PlatformIntegrationOperationsController(service);
  });

  describe("EC-20.1: Data Mapping Designer & Transforms", () => {
    it("lists existing data mappings", async () => {
      const mappings = await controller.listMappings();
      expect(mappings.length).toBeGreaterThanOrEqual(2);
      expect(mappings.some((m) => m.sourceEntity === "Account")).toBe(true);
    });

    it("creates and persists a new data mapping definition", async () => {
      const newMap = await controller.saveMapping({
        name: "Workday Workers → UniERP Employees",
        connectorId: "conn-workday",
        sourceEntity: "Worker",
        targetEntity: "Employee",
        fieldMappings: [
          { sourceField: "Worker_ID", targetField: "employeeNumber", transform: "UPPERCASE" },
          { sourceField: "Legal_Name", targetField: "fullName", transform: "TRIM" },
          { sourceField: "Base_Pay", targetField: "salary", transform: "PARSE_FLOAT" },
        ],
      });

      expect(newMap.id).toBeDefined();
      expect(newMap.name).toBe("Workday Workers → UniERP Employees");
      expect(newMap.fieldMappings.length).toBe(3);

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "integrations.mapping.create",
          targetId: newMap.id,
        })
      );
    });

    it("rejects invalid mappings with empty rules", async () => {
      await expect(
        controller.saveMapping({
          name: "Empty Mapping",
          connectorId: "conn-sfdc",
          sourceEntity: "A",
          targetEntity: "B",
          fieldMappings: [],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it("tests field mapping rules against sample payload and verifies transformation logic", async () => {
      const sampleRules: FieldMappingRule[] = [
        { sourceField: "company_name", targetField: "accountName", transform: "UPPERCASE" },
        { sourceField: "raw_revenue", targetField: "annualRevenue", transform: "PARSE_FLOAT" },
        { sourceField: "registration_date", targetField: "formattedDate", transform: "FORMAT_DATE" },
        { sourceField: "raw_email", targetField: "cleanEmail", transform: "LOWERCASE" },
        { sourceField: "untrimmed_notes", targetField: "notes", transform: "TRIM" },
      ];

      const samplePayload = {
        company_name: "acme global enterprises",
        raw_revenue: "$ 1,250,500.50 USD",
        registration_date: "2026-03-15T09:30:00Z",
        raw_email: "CEO@ACME-CORP.COM",
        untrimmed_notes: "   Priority enterprise account   ",
      };

      const transformed = await controller.testMapping({
        rules: sampleRules,
        samplePayload,
      });

      expect(transformed.accountName).toBe("ACME GLOBAL ENTERPRISES");
      expect(transformed.annualRevenue).toBe(1250500.5);
      expect(transformed.formattedDate).toBe("2026-03-15");
      expect(transformed.cleanEmail).toBe("ceo@acme-corp.com");
      expect(transformed.notes).toBe("Priority enterprise account");
    });
  });

  describe("EC-20.2: Sync Schedule Configuration", () => {
    it("lists sync jobs and creates a recurring schedule", async () => {
      const jobs = await controller.listSyncJobs();
      expect(jobs.length).toBeGreaterThanOrEqual(2);

      const created = await controller.createSyncJob({
        connectorId: "conn-sfdc",
        name: "Bi-Directional Contact Sync",
        direction: "BI_DIRECTIONAL",
        scheduleCron: "0 */4 * * *",
        conflictStrategy: "TARGET_WINS",
        batchSize: 1000,
      });

      expect(created.id).toBeDefined();
      expect(created.conflictStrategy).toBe("TARGET_WINS");
      expect(created.status).toBe("ENABLED");

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "integrations.sync_job.create",
          targetId: created.id,
        })
      );
    });

    it("toggles sync job status between ENABLED and PAUSED", async () => {
      const toggled = await controller.toggleSyncJob("job-sfdc-sync");
      expect(toggled.status).toBe("PAUSED");

      const toggledBack = await controller.toggleSyncJob("job-sfdc-sync");
      expect(toggledBack.status).toBe("ENABLED");

      await expect(controller.toggleSyncJob("non-existent-job")).rejects.toThrow(NotFoundException);
    });
  });

  describe("EC-20.3: Connector Health & Telemetry", () => {
    it("lists connectors and shows health metrics", async () => {
      const connectors = await controller.listConnectors();
      expect(connectors.length).toBeGreaterThanOrEqual(3);

      const sfdc = connectors.find((c) => c.id === "conn-sfdc");
      expect(sfdc?.status).toBe("HEALTHY");
      expect(sfdc?.throughputRowsSec).toBeGreaterThan(0);
    });

    it("triggers real-time health check / ping on a connector", async () => {
      const pinged = await controller.pingConnector("conn-netsuite");
      expect(pinged.status).toBe("HEALTHY");
      expect(pinged.latencyMs).toBeGreaterThan(0);

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "integrations.connector.health_check",
          targetId: "conn-netsuite",
        })
      );

      await expect(controller.pingConnector("non-existent-conn")).rejects.toThrow(NotFoundException);
    });
  });
});
