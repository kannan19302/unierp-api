import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    reportingScheduledJobDeep: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    reportingExecutionLog: {
      create: vi.fn(),
    },
  },
  idpPrisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@kannan19302/database";
import { idpClient } from "@/common/idp-client";
import { ReportingScheduledJobsDeepService } from "../reporting-scheduled-jobs-deep.service";

describe("ReportingScheduledJobsDeepService", () => {
  let service: ReportingScheduledJobsDeepService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportingScheduledJobsDeepService],
    }).compile();

    service = module.get<ReportingScheduledJobsDeepService>(
      ReportingScheduledJobsDeepService,
    );
    vi.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createJob", () => {
    it("should create scheduled report execution job", async () => {
      const mockResult = { id: "job-1", jobName: "Weekly Financial Summary" };
      (prisma.reportingScheduledJobDeep.create as any).mockResolvedValue(
        mockResult,
      );

      const res = await service.createJob("t1", {
        jobName: "Weekly Financial Summary",
        templateId: "tmpl-1",
        cronSchedule: "0 8 * * 1",
      });
      expect(res.jobName).toBe("Weekly Financial Summary");
    });
  });

  describe("executeJob — E36: per-recipient scoping, no fabricated success", () => {
    it("throws NotFoundException instead of executing a job belonging to another tenant (IDOR fix)", async () => {
      (prisma.reportingScheduledJobDeep.findFirst as any).mockResolvedValue(
        null,
      );

      await expect(service.executeJob("job-1", "t1")).rejects.toThrow(
        /not found/i,
      );
      expect(prisma.reportingScheduledJobDeep.update).not.toHaveBeenCalled();
      expect(prisma.reportingExecutionLog.create).not.toHaveBeenCalled();
    });

    it("excludes recipients who are not real tenant users, and reports the skip in the execution log", async () => {
      (prisma.reportingScheduledJobDeep.findFirst as any).mockResolvedValue({
        id: "job-1",
        tenantId: "t1",
        recipients: [
          "real-user@company.com",
          "not-a-tenant-user@outside.com",
        ],
      });
      (idpClient.user.findMany as any).mockResolvedValue([
        { email: "real-user@company.com" },
      ]);
      (prisma.reportingScheduledJobDeep.update as any).mockResolvedValue({
        id: "job-1",
      });
      (prisma.reportingExecutionLog.create as any).mockResolvedValue({});

      const result = await service.executeJob("job-1", "t1");

      expect(result.deliveredCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      const logCall = (prisma.reportingExecutionLog.create as any).mock
        .calls[0][0];
      expect(logCall.data.errorMessage).toMatch(/1 of 2 recipient/i);
      // No fabricated fixed metrics — executionMs is real (a number, not
      // the old hardcoded 1240).
      expect(typeof logCall.data.executionMs).toBe("number");
    });

    it("reports FAILED status when every recipient is excluded", async () => {
      (prisma.reportingScheduledJobDeep.findFirst as any).mockResolvedValue({
        id: "job-1",
        tenantId: "t1",
        recipients: ["ghost@nowhere.com"],
      });
      (idpClient.user.findMany as any).mockResolvedValue([]);
      (prisma.reportingScheduledJobDeep.update as any).mockResolvedValue({
        id: "job-1",
      });
      (prisma.reportingExecutionLog.create as any).mockResolvedValue({});

      const result = await service.executeJob("job-1", "t1");

      expect(result.deliveredCount).toBe(0);
      const logCall = (prisma.reportingExecutionLog.create as any).mock
        .calls[0][0];
      expect(logCall.data.status).toBe("FAILED");
    });
  });
});
