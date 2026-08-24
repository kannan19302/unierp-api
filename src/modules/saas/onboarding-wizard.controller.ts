import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { OnboardingWizardService } from "./onboarding-wizard.service";
import { MasterDataImportService } from "./master-data-import.service";
import {
  SaveWizardStepInput,
  ApplyIndustryBlueprintInput,
  ExecuteMasterDataImportInput,
  OnboardingWizardStep,
} from "@kannan19302/shared";

@ApiTags("saas-onboarding-wizard")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller("saas/onboarding/wizard")
export class OnboardingWizardController {
  constructor(
    private readonly wizardService: OnboardingWizardService,
    private readonly importService: MasterDataImportService,
  ) {}

  @ApiOperation({ summary: "Get current onboarding wizard state" })
  @Permissions("saas.portal.read")
  @Get("state")
  async getWizardState(@Req() req: any) {
    return this.wizardService.getWizardState(req.user.tenantId);
  }

  @ApiOperation({ summary: "Save progress for a specific wizard step" })
  @Permissions("saas.portal.update")
  @Put("step/:step")
  async saveWizardStep(
    @Req() req: any,
    @Param("step") step: OnboardingWizardStep,
    @Body() body: Record<string, any>,
  ) {
    return this.wizardService.saveWizardStep(
      req.user.tenantId,
      req.user.userId,
      step,
      body,
    );
  }

  @ApiOperation({ summary: "Apply industry blueprint" })
  @Permissions("saas.portal.create")
  @Post("blueprint/apply")
  async applyIndustryBlueprint(
    @Req() req: any,
    @Body() input: ApplyIndustryBlueprintInput,
  ) {
    return this.wizardService.applyIndustryBlueprint(
      req.user.tenantId,
      req.user.userId,
      input,
    );
  }

  @ApiOperation({ summary: "Batch invite team members during onboarding" })
  @Permissions("saas.portal.create")
  @Post("invite-team")
  async inviteTeam(
    @Req() req: any,
    @Body() body: { invites: Array<{ email: string; role: string; firstName?: string; lastName?: string }> },
  ) {
    return this.wizardService.inviteTeamMembers(
      req.user.tenantId,
      req.user.userId,
      body.invites || [],
    );
  }

  @ApiOperation({ summary: "Validate master data import rows" })
  @Permissions("saas.portal.read")
  @Post("import/validate")
  async validateImport(
    @Req() req: any,
    @Body() body: { entityType: any; rows: any[]; fieldMappings: Record<string, string> },
  ) {
    return this.importService.validateRows(
      req.user.tenantId,
      body.entityType,
      body.rows || [],
      body.fieldMappings || {},
    );
  }

  @ApiOperation({ summary: "Execute transactional master data import" })
  @Permissions("saas.portal.create")
  @Post("import/execute")
  async executeImport(
    @Req() req: any,
    @Body() input: ExecuteMasterDataImportInput,
  ) {
    return this.importService.executeImport(
      req.user.tenantId,
      req.user.userId,
      input,
    );
  }

  @ApiOperation({ summary: "List recent tenant master data import jobs" })
  @Permissions("saas.portal.read")
  @Get("import/jobs")
  async listImportJobs(@Req() req: any) {
    return this.importService.getTenantImportJobs(req.user.tenantId);
  }

  @ApiOperation({ summary: "Complete customer onboarding flow" })
  @Permissions("saas.portal.create")
  @Post("complete")
  async completeOnboarding(@Req() req: any) {
    return this.wizardService.completeOnboarding(
      req.user.tenantId,
      req.user.userId,
    );
  }
}
