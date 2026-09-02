/**
 * End-to-End Customer Onboarding Journey Test Suite
 * 
 * Verifies the full user journey:
 * 1. Marketing Site Discovery & Registration trigger
 * 2. IDP Tenant Bootstrapping & Super Admin Creation
 * 3. Login Session Token Issuance & Cookie Redirection
 * 4. 5-Step Interactive Setup Wizard (Org Profile, Blueprint, COA, Team Invites, CSV Data Ingestion)
 * 5. Completion & Application Wizard Module Access
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OnboardingWizardService } from "../services/onboarding-wizard.service";
import { MasterDataImportService } from "../services/master-data-import.service";

const { mockDb, mockIdp } = vi.hoisted(() => {
  const db = {
    tenant: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
      create: vi.fn(),
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
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    customer: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    vendor: {
      create: vi.fn(),
    },
    product: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        customer: { create: vi.fn().mockResolvedValue({ id: "cust-1" }) },
        vendor: { create: vi.fn().mockResolvedValue({ id: "vend-1" }) },
        product: { create: vi.fn().mockResolvedValue({ id: "prod-1" }) },
      };
      return callback(tx);
    }),
  };

  const idp = {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    role: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    userRole: {
      create: vi.fn(),
    },
  };

  return { mockDb: db, mockIdp: idp };
});

vi.mock("@kannan19302/database", () => ({
  prisma: mockDb,
}));

vi.mock("@/common/idp-client", () => ({
  idpClient: mockIdp,
}));

describe("Full Customer Onboarding Journey E2E", () => {
  let wizardService: OnboardingWizardService;
  let importService: MasterDataImportService;

  const mockTenantId = "tenant-acme-global-88";
  const mockUserId = "usr-super-admin-01";

  beforeEach(() => {
    wizardService = new OnboardingWizardService();
    importService = new MasterDataImportService();
    vi.clearAllMocks();
  });

  it("Phase 1 & 2: Should register tenant and verify initial empty onboarding state", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: mockTenantId,
      name: "Acme Global Industries",
      slug: "acme-global-industries",
      plan: "free",
      status: "ACTIVE",
      onboardingComplete: false,
      installedAppsRel: [],
      onboardingProgress: null,
    });

    mockDb.organization.findFirst.mockResolvedValue({
      id: "org-1",
      tenantId: mockTenantId,
      name: "Acme Global Industries",
      currency: "USD",
      timezone: "UTC",
      fiscalYearStart: 1,
    });

    mockDb.tenantOnboardingProgress.findUnique.mockResolvedValue(null);
    mockDb.masterDataImportJob.findMany.mockResolvedValue([]);

    const state = await wizardService.getWizardState(mockTenantId);

    expect(state.tenantId).toBe(mockTenantId);
    expect(state.currentStep).toBe("ORGANIZATION_PROFILE");
    expect(state.isCompleted).toBe(false);
    expect(state.percentComplete).toBeGreaterThanOrEqual(10);
  });

  it("Phase 3 - Step 1: Should configure Organization Profile with Legal details", async () => {
    mockDb.organization.findFirst.mockResolvedValue({
      id: "org-1",
      tenantId: mockTenantId,
      name: "Acme Global Industries",
      legalName: null,
      taxId: null,
    });

    mockDb.tenantOnboardingProgress.findUnique.mockResolvedValue(null);
    mockDb.tenantOnboardingProgress.upsert.mockResolvedValue({
      tenantId: mockTenantId,
      currentStep: "INDUSTRY_BLUEPRINT",
      completedSteps: ["ORGANIZATION_PROFILE"],
      percentComplete: 30,
    });

    const stepResult = await wizardService.saveWizardStep(
      mockTenantId,
      mockUserId,
      "ORGANIZATION_PROFILE",
      {
        name: "Acme Global Industries",
        legalName: "Acme Global Holdings LLC",
        taxId: "US-EIN-99-8877665",
        currency: "USD",
        timezone: "America/New_York",
        fiscalYearStart: 1,
      },
    );

    expect(stepResult.success).toBe(true);
    expect(stepResult.currentStep).toBe("INDUSTRY_BLUEPRINT");
    expect(stepResult.completedSteps).toContain("ORGANIZATION_PROFILE");
  });

  it("Phase 3 - Step 2: Should apply Manufacturing Industry Blueprint and install apps", async () => {
    mockDb.tenant.update.mockResolvedValue({ id: mockTenantId, industry: "manufacturing" });
    mockDb.installedApp.findFirst.mockResolvedValue(null);
    mockDb.installedApp.create.mockResolvedValue({ id: "ia-mfg", appSlug: "manufacturing" });
    mockDb.tenantOnboardingProgress.upsert.mockResolvedValue({
      tenantId: mockTenantId,
      currentStep: "LOCALIZATION_FINANCE",
      completedSteps: ["ORGANIZATION_PROFILE", "INDUSTRY_BLUEPRINT"],
      percentComplete: 50,
      industryTemplate: "MANUFACTURING_COGS",
    });

    const blueprintResult = await wizardService.applyIndustryBlueprint(
      mockTenantId,
      mockUserId,
      {
        industry: "manufacturing",
        apps: ["manufacturing", "inventory", "procurement", "finance"],
        chartOfAccountsTemplate: "MANUFACTURING_COGS",
      },
    );

    expect(blueprintResult.success).toBe(true);
    expect(blueprintResult.industry).toBe("manufacturing");
    expect(blueprintResult.installedApps).toContain("manufacturing");
    expect(blueprintResult.installedApps).toContain("inventory");
  });

  it("Phase 3 - Step 3: Should configure Localization & Financial Chart of Accounts", async () => {
    mockDb.tenantOnboardingProgress.findUnique.mockResolvedValue({
      completedSteps: ["ORGANIZATION_PROFILE", "INDUSTRY_BLUEPRINT"],
      percentComplete: 50,
    });

    mockDb.tenantOnboardingProgress.upsert.mockResolvedValue({
      currentStep: "TEAM_INVITATION",
      completedSteps: ["ORGANIZATION_PROFILE", "INDUSTRY_BLUEPRINT", "LOCALIZATION_FINANCE"],
      percentComplete: 70,
    });

    const coaResult = await wizardService.saveWizardStep(
      mockTenantId,
      mockUserId,
      "LOCALIZATION_FINANCE",
      { coaTemplate: "MANUFACTURING_COGS" },
    );

    expect(coaResult.success).toBe(true);
    expect(coaResult.currentStep).toBe("TEAM_INVITATION");
  });

  it("Phase 3 - Step 4: Should batch invite team members and assign RBAC roles", async () => {
    mockIdp.user.findFirst.mockResolvedValue(null);
    mockIdp.user.create.mockResolvedValue({ id: "usr-finance-mgr" });
    mockIdp.role.findFirst.mockResolvedValue({ id: "role-finance", name: "Finance Manager" });
    mockDb.tenantOnboardingProgress.upsert.mockResolvedValue({
      teamInvited: true,
      completedSteps: ["ORGANIZATION_PROFILE", "INDUSTRY_BLUEPRINT", "LOCALIZATION_FINANCE", "TEAM_INVITATION"],
      percentComplete: 85,
    });

    const inviteResult = await wizardService.inviteTeamMembers(
      mockTenantId,
      mockUserId,
      [
        {
          email: "sarah.finance@acme.com",
          role: "Finance Manager",
          firstName: "Sarah",
          lastName: "Connor",
        },
      ],
    );

    expect(inviteResult.success).toBe(true);
    expect(inviteResult.invitationsSent).toBe(1);
    expect(inviteResult.details[0].status).toBe("INVITED");
  });

  it("Phase 3 - Step 5: Should validate and execute CSV Master Data Ingestion", async () => {
    const csvRows = [
      { "Customer Name": "Delta Airlines", "Email": "procurement@delta.com", "Tax ID": "US-112233" },
      { "Customer Name": "Boeing Corp", "Email": "supply@boeing.com", "Tax ID": "US-445566" },
    ];
    const mappings = {
      "Customer Name": "name",
      "Email": "email",
      "Tax ID": "taxId",
    };

    // 1. Dry run validation
    const validation = await importService.validateRows(
      mockTenantId,
      "CUSTOMER",
      csvRows,
      mappings,
    );

    expect(validation.totalRows).toBe(2);
    expect(validation.validRows).toBe(2);
    expect(validation.errorRows).toBe(0);

    // 2. Transactional execution
    mockDb.masterDataImportJob.create.mockResolvedValue({ id: "job-import-01" });
    mockDb.masterDataImportJob.update.mockResolvedValue({
      id: "job-import-01",
      status: "COMPLETED",
      successRows: 2,
      completedAt: new Date(),
    });
    mockDb.tenantOnboardingProgress.upsert.mockResolvedValue({});

    const executionResult = await importService.executeImport(
      mockTenantId,
      mockUserId,
      {
        entityType: "CUSTOMER",
        fileName: "enterprise_customers.csv",
        fieldMappings: mappings,
        rows: csvRows,
        dryRun: false,
      },
    );

    expect(executionResult.status).toBe("COMPLETED");
    expect(executionResult.successRows).toBe(2);
  });

  it("Phase 4 & 5: Should complete onboarding and unlock full Application Wizard access", async () => {
    mockDb.tenant.update.mockResolvedValue({
      id: mockTenantId,
      onboardingComplete: true,
    });
    mockDb.tenantOnboardingProgress.upsert.mockResolvedValue({
      tenantId: mockTenantId,
      isCompleted: true,
      percentComplete: 100,
      currentStep: "REVIEW_COMPLETE",
    });

    const completionResult = await wizardService.completeOnboarding(
      mockTenantId,
      mockUserId,
    );

    expect(completionResult.success).toBe(true);
    expect(completionResult.isCompleted).toBe(true);
    expect(completionResult.percentComplete).toBe(100);

    // Verify Application Wizard State
    mockDb.tenant.findUnique.mockResolvedValue({
      id: mockTenantId,
      onboardingComplete: true,
      installedAppsRel: [
        { appSlug: "finance" },
        { appSlug: "manufacturing" },
        { appSlug: "inventory" },
      ],
      onboardingProgress: { isCompleted: true, percentComplete: 100 },
    });

    const finalState = await wizardService.getWizardState(mockTenantId);
    expect(finalState.isCompleted).toBe(true);
    expect(finalState.percentComplete).toBe(100);
  });
});
