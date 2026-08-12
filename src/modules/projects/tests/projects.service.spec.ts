import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectsService } from "../projects.service";

vi.mock("@kannan19302/database", () => {
  const mockPrisma: any = {
    project: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    timesheet: {
      create: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
    },
    projectCostEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    invoice: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
    },
    documentSequence: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  mockPrisma.$transaction = vi.fn((fn: any) => fn(mockPrisma));
  return { prisma: mockPrisma };
});

import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { DocumentNumberingService } from "@/common/services/document-numbering.service";

describe("ProjectsService", () => {
  let service: ProjectsService;

  beforeEach(() => {
    service = new ProjectsService(new DocumentNumberingService());
    vi.clearAllMocks();
  });

  describe("getProjects", () => {
    it("should return all projects in a tenant", async () => {
      const mockProjects = [
        { id: "p-1", name: "Test Project", code: "PRJ-1", status: "ACTIVE" },
      ];
      vi.mocked(prisma.project.findMany).mockResolvedValue(
        mockProjects as never,
      );

      const result = await service.getProjects("tenant-1");
      expect(result).toHaveLength(1);
      expect(result[0]?.code).toBe("PRJ-1");
    });
  });

  describe("createProject", () => {
    it("should create a project successfully", async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue({
        id: "org-1",
      } as never);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.project.create).mockResolvedValue({
        id: "p-1",
        name: "New Project",
        code: "PRJ-NEW",
      } as never);

      const dto = { name: "New Project", code: "PRJ-NEW" };
      const result = await service.createProject(
        "tenant-1",
        "org-1",
        dto,
        "user-1",
      );

      expect(result).toBeDefined();
      expect(result.code).toBe("PRJ-NEW");
    });
  });

  describe("createCostEntry", () => {
    it("should create a cost entry successfully", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({
        id: "p-1",
        name: "Test",
      } as never);
      vi.mocked(prisma.projectCostEntry.create).mockResolvedValue({
        id: "ce-1",
        type: "LABOR",
        amount: 150,
      } as never);

      const dto = {
        type: "LABOR",
        amount: 150,
        date: "2026-07-09",
        description: "Labor work",
      };
      const result = await service.createCostEntry("tenant-1", "p-1", dto);
      expect(result).toBeDefined();
      expect(result.type).toBe("LABOR");
    });

    it("should throw BadRequestException if type is invalid", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({
        id: "p-1",
        name: "Test",
      } as never);
      const dto = { type: "INVALID", amount: 150, date: "2026-07-09" };
      await expect(
        service.createCostEntry("tenant-1", "p-1", dto),
      ).rejects.toThrow();
    });
  });

  describe("getCostEntries", () => {
    it("should return all cost entries for a project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({
        id: "p-1",
      } as never);
      vi.mocked(prisma.projectCostEntry.findMany).mockResolvedValue([
        { id: "ce-1", type: "MATERIAL", amount: 500 },
      ] as never);

      const result = await service.getCostEntries("tenant-1", "p-1");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("MATERIAL");
    });
  });

  describe("deleteCostEntry", () => {
    it("should delete a cost entry successfully", async () => {
      vi.mocked(prisma.projectCostEntry.findFirst).mockResolvedValue({
        id: "ce-1",
        tenantId: "tenant-1",
      } as never);
      vi.mocked(prisma.projectCostEntry.delete).mockResolvedValue({
        id: "ce-1",
      } as never);

      const result = await service.deleteCostEntry("tenant-1", "ce-1");
      expect(result).toBeDefined();
      expect(result.id).toBe("ce-1");
    });
  });

  describe("getProjectWip", () => {
    it("should compute WIP correctly", async () => {
      const mockProject = {
        id: "p-1",
        name: "WIP Project",
        code: "WIP-1",
        status: "ACTIVE",
        estimatedCost: 1000,
        contractValue: 5000,
        costEntries: [
          { type: "LABOR", amount: 200 },
          { type: "MATERIAL", amount: 300 },
        ],
        invoices: [{ totalAmount: 1500 }],
      };
      vi.mocked(prisma.project.findFirst).mockResolvedValue(
        mockProject as never,
      );

      const result = await service.getProjectWip("tenant-1", "p-1");
      expect(result.totalCost).toBe(500);
      expect(result.percentComplete).toBe(50); // 500 / 1000 * 100
      expect(result.recognizedRevenue).toBe(2500); // 50% of 5000
      expect(result.billedAmount).toBe(1500);
      expect(result.overUnderBilling).toBe(1000); // Underbilled (Asset)
      expect(result.billingStatus).toBe("UNDERBILLED");
    });
  });

  describe("generateProjectInvoice — E24: milestone billing must not double-bill", () => {
    const baseProject = {
      id: "p-1",
      orgId: "org-1",
      code: "PRJ-1",
      name: "Test Project",
      customerId: "cust-1",
      tasks: [],
      milestones: [
        { id: "m-1", name: "Design Phase", isCompleted: true },
      ],
    };

    it("REFUSES to re-bill a milestone that was already invoiced in a prior, non-void invoice", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue(
        baseProject as never,
      );
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: "inv-existing",
          lineItems: [
            {
              description: "Project Milestone Completed: Design Phase",
            },
          ],
        },
      ] as never);

      await expect(
        service.generateProjectInvoice("tenant-1", "p-1", "user-1"),
      ).rejects.toThrow(/No completed milestones or timesheet hours/i);

      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it("bills a completed milestone that has never been invoiced before", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue(
        baseProject as never,
      );
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.documentSequence.findFirst).mockResolvedValue(null as never);
      vi.mocked(prisma.documentSequence.create).mockResolvedValue({
        id: "seq-1",
        tenantId: "tenant-1",
        series: "INVOICE_PROJECT",
        organizationId: "org-1",
        prefix: "INV-PRJ-",
        suffix: "",
        padding: 4,
        nextNumber: 1,
        format: "{prefix}{number}{suffix}",
      } as never);
      vi.mocked(prisma.documentSequence.update).mockResolvedValue({
        id: "seq-1",
        prefix: "INV-PRJ-",
        suffix: "",
        padding: 4,
        nextNumber: 2,
        format: "{prefix}{number}{suffix}",
      } as never);
      vi.mocked(prisma.invoice.create).mockResolvedValue({
        id: "inv-1",
        lineItems: [],
      } as never);

      const result = await service.generateProjectInvoice(
        "tenant-1",
        "p-1",
        "user-1",
      );

      expect(result).toBeDefined();
      expect(prisma.invoice.create).toHaveBeenCalled();
    });
  });
});
