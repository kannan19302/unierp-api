import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import {
  OnboardingWizardState,
  OnboardingWizardStep,
  ApplyIndustryBlueprintInput,
} from "@kannan19302/shared";

@Injectable()
export class OnboardingWizardService {
  private readonly logger = new Logger(OnboardingWizardService.name);

  /**
   * Retrieves the current persistent setup wizard state for the tenant.
   */
  async getWizardState(tenantId: string): Promise<OnboardingWizardState> {
    const [tenant, org, progress, importJobs] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          installedAppsRel: true,
          onboardingProgress: true,
        },
      }),
      prisma.organization.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.tenantOnboardingProgress.findUnique({
        where: { tenantId },
      }),
      prisma.masterDataImportJob.findMany({
        where: { tenantId, status: "COMPLETED" },
      }),
    ]);

    if (!tenant) {
      throw new NotFoundException("Tenant not found");
    }

    const completedSteps = progress?.completedSteps || [];
    const isCompleted = tenant.onboardingComplete || Boolean(progress?.isCompleted);

    // Calculate dynamic percentage
    let calculatedPercent = progress?.percentComplete || 0;
    if (!progress) {
      if (org) calculatedPercent += 25;
      if (tenant.installedAppsRel.length > 0) calculatedPercent += 25;
    }

    const currentStep = (progress?.currentStep as OnboardingWizardStep) || "ORGANIZATION_PROFILE";

    const dataImportSummary = {
      customersImported: importJobs
        .filter((j) => j.entityType === "CUSTOMER")
        .reduce((sum, j) => sum + j.successRows, 0),
      vendorsImported: importJobs
        .filter((j) => j.entityType === "VENDOR")
        .reduce((sum, j) => sum + j.successRows, 0),
      itemsImported: importJobs
        .filter((j) => j.entityType === "ITEM")
        .reduce((sum, j) => sum + j.successRows, 0),
      accountsImported: importJobs
        .filter((j) => j.entityType === "GL_ACCOUNT")
        .reduce((sum, j) => sum + j.successRows, 0),
    };

    return {
      tenantId,
      currentStep,
      completedSteps,
      percentComplete: isCompleted ? 100 : Math.min(100, Math.max(calculatedPercent, 10)),
      isCompleted,
      organization: org
        ? {
            name: org.name,
            legalName: org.legalName || undefined,
            taxId: org.taxId || undefined,
            currency: org.currency || "USD",
            timezone: org.timezone || "UTC",
            fiscalYearStart: org.fiscalYearStart || 1,
          }
        : undefined,
      industryBlueprint: tenant.industry
        ? {
            industry: tenant.industry,
            selectedApps: tenant.installedAppsRel
              .map((a) => a.appSlug)
              .filter((appSlug): appSlug is string => appSlug !== null),
            chartOfAccountsTemplate: progress?.industryTemplate || "GAAP_STANDARD",
          }
        : undefined,
      teamInvites: [],
      dataImportSummary,
    };
  }

  /**
   * Saves data and advances a specific setup wizard step.
   */
  async saveWizardStep(
    tenantId: string,
    userId: string,
    step: OnboardingWizardStep,
    data: Record<string, any>,
  ) {
    let nextStep: OnboardingWizardStep = step;
    let stepPercent = 20;

    if (step === "ORGANIZATION_PROFILE") {
      const org = await prisma.organization.findFirst({
        where: { tenantId },
      });

      if (org) {
        await prisma.organization.update({
          where: { id: org.id },
          data: {
            name: data.name || org.name,
            legalName: data.legalName || org.legalName,
            taxId: data.taxId || org.taxId,
            currency: data.currency || org.currency,
            timezone: data.timezone || org.timezone,
            fiscalYearStart: data.fiscalYearStart || org.fiscalYearStart,
          },
        });
      }
      nextStep = "INDUSTRY_BLUEPRINT";
      stepPercent = 30;
    } else if (step === "INDUSTRY_BLUEPRINT") {
      if (data.industry) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { industry: data.industry },
        });
      }
      nextStep = "LOCALIZATION_FINANCE";
      stepPercent = 50;
    } else if (step === "LOCALIZATION_FINANCE") {
      nextStep = "TEAM_INVITATION";
      stepPercent = 70;
    } else if (step === "TEAM_INVITATION") {
      nextStep = "DATA_INGESTION";
      stepPercent = 85;
    } else if (step === "DATA_INGESTION") {
      nextStep = "REVIEW_COMPLETE";
      stepPercent = 95;
    }

    const existingProgress = await prisma.tenantOnboardingProgress.findUnique({
      where: { tenantId },
    });

    const completedStepsSet = new Set(existingProgress?.completedSteps || []);
    completedStepsSet.add(step);

    const updatedProgress = await prisma.tenantOnboardingProgress.upsert({
      where: { tenantId },
      create: {
        tenantId,
        currentStep: nextStep,
        completedSteps: Array.from(completedStepsSet),
        percentComplete: stepPercent,
      },
      update: {
        currentStep: nextStep,
        completedSteps: Array.from(completedStepsSet),
        percentComplete: Math.max(existingProgress?.percentComplete || 0, stepPercent),
      },
    });

    return {
      success: true,
      currentStep: nextStep,
      completedSteps: updatedProgress.completedSteps,
      percentComplete: updatedProgress.percentComplete,
    };
  }

  /**
   * Applies selected industry blueprint and auto-provisions default applications.
   */
  async applyIndustryBlueprint(
    tenantId: string,
    userId: string,
    input: ApplyIndustryBlueprintInput,
  ) {
    const { industry, apps, chartOfAccountsTemplate } = input;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { industry },
    });

    // Install specified apps if not already installed
    for (const appSlug of apps) {
      const existing = await prisma.installedApp.findFirst({
        where: { tenantId, appSlug },
      });

      if (!existing) {
        await prisma.installedApp.create({
          data: {
            tenantId,
            appId: appSlug,
            appSlug,
            status: "ACTIVE",
            installedBy: userId,
            source: "BLUEPRINT",
          },
        });
      }
    }

    // Update progress state
    await prisma.tenantOnboardingProgress.upsert({
      where: { tenantId },
      create: {
        tenantId,
        industryTemplate: chartOfAccountsTemplate,
        currentStep: "LOCALIZATION_FINANCE",
        completedSteps: ["ORGANIZATION_PROFILE", "INDUSTRY_BLUEPRINT"],
        percentComplete: 50,
      },
      update: {
        industryTemplate: chartOfAccountsTemplate,
        completedSteps: {
          push: "INDUSTRY_BLUEPRINT",
        },
        percentComplete: 50,
      },
    });

    return {
      success: true,
      industry,
      installedApps: apps,
      chartOfAccountsTemplate,
    };
  }

  /**
   * Batch invites team members with assigned roles during onboarding.
   */
  async inviteTeamMembers(
    tenantId: string,
    userId: string,
    invites: Array<{ email: string; role: string; firstName?: string; lastName?: string }>,
  ) {
    const results: Array<{
      email: string;
      status: "INVITED" | "ALREADY_EXISTS";
      userId: string;
    }> = [];

    for (const invite of invites) {
      const email = invite.email.toLowerCase().trim();
      const existing = await idpPrisma.user.findFirst({
        where: { tenantId, email },
      });

      if (!existing) {
        const createdUser = await idpPrisma.user.create({
          data: {
            tenantId,
            email,
            firstName: invite.firstName || "",
            lastName: invite.lastName || "",
            status: "INVITED",
          },
        });

        // Find or assign role
        const role = await idpPrisma.role.findFirst({
          where: {
            tenantId,
            name: { equals: invite.role, mode: "insensitive" },
          },
        });

        if (role) {
          await idpPrisma.userRole.create({
            data: {
              userId: createdUser.id,
              roleId: role.id,
            },
          });
        }

        results.push({ email, status: "INVITED", userId: createdUser.id });
      } else {
        results.push({ email, status: "ALREADY_EXISTS", userId: existing.id });
      }
    }

    await prisma.tenantOnboardingProgress.upsert({
      where: { tenantId },
      create: {
        tenantId,
        teamInvited: true,
        completedSteps: ["TEAM_INVITATION"],
        percentComplete: 75,
      },
      update: {
        teamInvited: true,
        completedSteps: {
          push: "TEAM_INVITATION",
        },
      },
    });

    return {
      success: true,
      invitationsSent: results.length,
      details: results,
    };
  }

  /**
   * Completes the onboarding wizard and transitions tenant into fully active production state.
   */
  async completeOnboarding(tenantId: string, userId: string) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        onboardingComplete: true,
      },
    });

    await prisma.tenantOnboardingProgress.upsert({
      where: { tenantId },
      create: {
        tenantId,
        isCompleted: true,
        percentComplete: 100,
        completedAt: new Date(),
        currentStep: "REVIEW_COMPLETE",
      },
      update: {
        isCompleted: true,
        percentComplete: 100,
        completedAt: new Date(),
        currentStep: "REVIEW_COMPLETE",
      },
    });

    return {
      success: true,
      isCompleted: true,
      percentComplete: 100,
      completedAt: new Date().toISOString(),
    };
  }
}
