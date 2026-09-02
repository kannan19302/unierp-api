import { describe, it, expect, vi, beforeEach } from "vitest";
import { OnboardingWizardService } from "../services/onboarding-wizard.service";
import { MasterDataImportService } from "../services/master-data-import.service";

vi.mock("@kannan19302/database", () => {
  const customer = { create: vi.fn() };
  const vendor = { create: vi.fn() };
  const product = { create: vi.fn() };
  return { prisma: {
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    tenantOnboardingProgress: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    masterDataImportJob: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    installedApp: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    customer,
    vendor,
    product,
    $transaction: vi.fn(async (callback) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        customer,
        vendor,
        product,
      };
      return callback(tx);
    }),
  }};
});

vi.mock("@/common/idp-client", () => ({
  idpClient: {
    user: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "u-invited-1" }),
    },
    role: {
      findFirst: vi.fn().mockResolvedValue({ id: "r-admin" }),
    },
    userRole: {
      create: vi.fn(),
    },
  },
}));

describe("OnboardingWizardService", () => {
  let wizardService: OnboardingWizardService;
  let importService: MasterDataImportService;

  beforeEach(() => {
    wizardService = new OnboardingWizardService();
    importService = new MasterDataImportService();
    vi.clearAllMocks();
  });

  it("should get wizard state and compute progress percentage", async () => {
    const { prisma } = await import("@kannan19302/database");
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: "tenant-1",
      name: "Acme Corp",
      onboardingComplete: false,
      installedAppsRel: [{ appSlug: "finance" }, { appSlug: "inventory" }],
      onboardingProgress: null,
    } as any);

    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: "org-1",
      name: "Acme Corp",
      currency: "USD",
      timezone: "UTC",
      fiscalYearStart: 1,
    } as any);

    vi.mocked(prisma.tenantOnboardingProgress.findUnique).mockResolvedValue({
      tenantId: "tenant-1",
      currentStep: "INDUSTRY_BLUEPRINT",
      completedSteps: ["ORGANIZATION_PROFILE"],
      percentComplete: 30,
      isCompleted: false,
    } as any);

    vi.mocked(prisma.masterDataImportJob.findMany).mockResolvedValue([]);

    const state = await wizardService.getWizardState("tenant-1");

    expect(state.tenantId).toBe("tenant-1");
    expect(state.currentStep).toBe("INDUSTRY_BLUEPRINT");
    expect(state.completedSteps).toContain("ORGANIZATION_PROFILE");
    expect(state.percentComplete).toBe(30);
    expect(state.isCompleted).toBe(false);
  });

  it("should save wizard step and advance to next step", async () => {
    const { prisma } = await import("@kannan19302/database");
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: "org-1",
      name: "Acme Corp",
      legalName: "Acme LLC",
    } as any);

    vi.mocked(prisma.tenantOnboardingProgress.findUnique).mockResolvedValue({
      completedSteps: [],
      percentComplete: 0,
    } as any);

    vi.mocked(prisma.tenantOnboardingProgress.upsert).mockResolvedValue({
      currentStep: "INDUSTRY_BLUEPRINT",
      completedSteps: ["ORGANIZATION_PROFILE"],
      percentComplete: 30,
    } as any);

    const result = await wizardService.saveWizardStep(
      "tenant-1",
      "user-1",
      "ORGANIZATION_PROFILE",
      { name: "Acme Updated", currency: "EUR" },
    );

    expect(result.success).toBe(true);
    expect(result.currentStep).toBe("INDUSTRY_BLUEPRINT");
    expect(result.completedSteps).toContain("ORGANIZATION_PROFILE");
  });

  it("should apply industry blueprint and auto-install apps", async () => {
    const { prisma } = await import("@kannan19302/database");
    vi.mocked(prisma.tenant.update).mockResolvedValue({ id: "tenant-1" } as any);
    vi.mocked(prisma.installedApp.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.installedApp.create).mockResolvedValue({ id: "ia-1" } as any);
    vi.mocked(prisma.tenantOnboardingProgress.upsert).mockResolvedValue({
      completedSteps: ["ORGANIZATION_PROFILE", "INDUSTRY_BLUEPRINT"],
      percentComplete: 50,
    } as any);

    const result = await wizardService.applyIndustryBlueprint(
      "tenant-1",
      "user-1",
      {
        industry: "manufacturing",
        apps: ["manufacturing", "inventory", "procurement"],
        chartOfAccountsTemplate: "MANUFACTURING_COGS",
      },
    );

    expect(result.success).toBe(true);
    expect(result.industry).toBe("manufacturing");
    expect(result.installedApps).toHaveLength(3);
  });
});

describe("MasterDataImportService", () => {
  let service: MasterDataImportService;

  beforeEach(() => {
    service = new MasterDataImportService();
  });

  it("should validate CSV rows and report missing required fields", async () => {
    const rows = [
      { "Cust Name": "Acme Client", "Cust Email": "client@acme.com" },
      { "Cust Name": "", "Cust Email": "invalid-email" },
    ];
    const mappings = {
      "Cust Name": "name",
      "Cust Email": "email",
    };

    const validation = await service.validateRows(
      "tenant-1",
      "CUSTOMER",
      rows,
      mappings,
    );

    expect(validation.totalRows).toBe(2);
    expect(validation.validRows).toBe(1);
    expect(validation.errorRows).toBe(1);
    expect(validation.errors).toHaveLength(2); // missing name + invalid email
  });

  it("should execute dry-run validation without writing to database", async () => {
    const rows = [
      { "Cust Name": "Acme Valid", "Cust Email": "valid@acme.com" },
    ];
    const mappings = {
      "Cust Name": "name",
      "Cust Email": "email",
    };

    const result = await service.executeImport("tenant-1", "user-1", {
      entityType: "CUSTOMER",
      fileName: "customers.csv",
      fieldMappings: mappings,
      rows,
      dryRun: true,
    });

    expect(result.isDryRun).toBe(true);
    expect(result.validation.validRows).toBe(1);
  });

  it("should scope imported customers to the tenant's organization", async () => {
    const { prisma } = await import("@kannan19302/database");
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any);
    vi.mocked(prisma.masterDataImportJob.create).mockResolvedValue({ id: "job-1" } as any);
    vi.mocked(prisma.masterDataImportJob.update).mockResolvedValue({ id: "job-1", status: "COMPLETED" } as any);
    vi.mocked(prisma.tenantOnboardingProgress.upsert).mockResolvedValue({} as any);

    await service.executeImport("tenant-1", "user-1", {
      entityType: "CUSTOMER",
      fileName: "customers.csv",
      fieldMappings: { Name: "name", Email: "email" },
      rows: [{ Name: "Acme Client", Email: "client@acme.test" }],
      dryRun: false,
    });

    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        orgId: "org-1",
        name: "Acme Client",
      }),
    });
  });

  it("should map item price to the canonical sellPrice field", async () => {
    const { prisma } = await import("@kannan19302/database");
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any);
    vi.mocked(prisma.masterDataImportJob.create).mockResolvedValue({ id: "job-2" } as any);
    vi.mocked(prisma.masterDataImportJob.update).mockResolvedValue({ id: "job-2", status: "COMPLETED" } as any);
    vi.mocked(prisma.tenantOnboardingProgress.upsert).mockResolvedValue({} as any);

    await service.executeImport("tenant-1", "user-1", {
      entityType: "ITEM",
      fileName: "items.csv",
      fieldMappings: { Name: "name", SKU: "sku", Price: "price" },
      rows: [{ Name: "Widget", SKU: "W-1", Price: "19.95" }],
      dryRun: false,
    });

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        orgId: "org-1",
        sku: "W-1",
        sellPrice: 19.95,
      }),
    });
  });
});
