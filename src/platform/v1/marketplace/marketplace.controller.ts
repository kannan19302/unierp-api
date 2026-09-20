import { Controller, Get, Post, Param, Body, Query, UseGuards, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  MarketplaceService,
  SubmissionStage,
  ReviewChecklist,
} from './marketplace.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../../common/guards/rbac.guard';
import { ControlPlaneGuard } from '../../../common/guards/control-plane.guard';
import { SkipTenantScope } from '../../../common/decorators/skip-tenant-scope.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';

@ApiTags('Platform Marketplace & Partner Operations (PCC-17)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@Controller('platform/v1/marketplace')
@SkipTenantScope()
export class MarketplaceController {
  constructor(@Inject(MarketplaceService) private readonly marketplace: MarketplaceService) {}

  // --- 1. Submission Review Pipeline (EC-17.1) ---

  @ApiOperation({ summary: 'List marketplace app submissions' })
  @Permissions('system.marketplace.read')
  @Get('submissions')
  listSubmissions(@Query('stage') stage?: string) {
    return this.marketplace.listSubmissions(stage);
  }

  @ApiOperation({ summary: 'Get marketplace submission by ID' })
  @Permissions('system.marketplace.read')
  @Get('submissions/:id')
  getSubmission(@Param('id') id: string) {
    return this.marketplace.getSubmission(id);
  }

  @ApiOperation({ summary: 'Assign reviewer to submission' })
  @Permissions('system.marketplace.write')
  @Post('submissions/:id/assign')
  assignReviewer(
    @Param('id') id: string,
    @Body() body: { reviewerId: string; reviewerName: string; actorId?: string }
  ) {
    return this.marketplace.assignReviewer(
      id,
      body.reviewerId,
      body.reviewerName,
      body.actorId || 'SUPER_ADMIN'
    );
  }

  @ApiOperation({ summary: 'Transition submission pipeline stage with checklist update' })
  @Permissions('system.marketplace.write')
  @Post('submissions/:id/stage')
  updateSubmissionStage(
    @Param('id') id: string,
    @Body()
    body: {
      stage: SubmissionStage;
      checklist?: Partial<ReviewChecklist>;
      feedbackNotes?: string;
      actorId?: string;
    }
  ) {
    return this.marketplace.updateSubmissionStage(
      id,
      body.stage,
      body.checklist,
      body.feedbackNotes,
      body.actorId || 'SUPER_ADMIN'
    );
  }

  @ApiOperation({ summary: 'Approve extension submission for marketplace release' })
  @Permissions('system.marketplace.write')
  @Post('submissions/:id/approve')
  approveExtension(@Param('id') id: string, @Body() body?: { actorId?: string }) {
    return this.marketplace.approveExtension(id, body?.actorId || 'SUPER_ADMIN');
  }

  @ApiOperation({ summary: 'Reject extension submission with feedback' })
  @Permissions('system.marketplace.write')
  @Post('submissions/:id/reject')
  rejectExtension(
    @Param('id') id: string,
    @Body() body: { reason: string; actorId?: string }
  ) {
    return this.marketplace.rejectExtension(id, body.reason, body?.actorId || 'SUPER_ADMIN');
  }

  // --- 2. Version Management & Staged Rollouts (EC-17.2) ---

  @ApiOperation({ summary: 'List versions of a marketplace extension' })
  @Permissions('system.marketplace.read')
  @Get('extensions/:appSlug/versions')
  listVersions(@Param('appSlug') appSlug: string) {
    return this.marketplace.listVersions(appSlug);
  }

  @ApiOperation({ summary: 'Update staged rollout percentage for an extension version' })
  @Permissions('system.marketplace.write')
  @Post('extensions/:appSlug/versions/:version/rollout')
  updateRolloutPercentage(
    @Param('appSlug') appSlug: string,
    @Param('version') version: string,
    @Body() body: { percentage: number; actorId?: string }
  ) {
    return this.marketplace.updateRolloutPercentage(
      appSlug,
      version,
      body.percentage,
      body.actorId || 'SUPER_ADMIN'
    );
  }

  @ApiOperation({ summary: 'Rollback extension to a previous stable version' })
  @Permissions('system.marketplace.write')
  @Post('extensions/:appSlug/rollback')
  rollbackVersion(
    @Param('appSlug') appSlug: string,
    @Body() body: { targetVersion: string; reason: string; actorId?: string }
  ) {
    return this.marketplace.rollbackVersion(
      appSlug,
      body.targetVersion,
      body.reason,
      body.actorId || 'SUPER_ADMIN'
    );
  }

  // --- 3. Existing Inventory & Emergency Revocation (G-20) ---

  @ApiOperation({ summary: 'List active installed extensions across tenants' })
  @Permissions('system.marketplace.read')
  @Get('extensions')
  listExtensions() {
    return this.marketplace.listExtensions();
  }

  @ApiOperation({ summary: 'Get active installations of an extension' })
  @Permissions('system.marketplace.read')
  @Get('extensions/:appSlug/installations')
  getInstallations(@Param('appSlug') appSlug: string) {
    return this.marketplace.getExtensionInstallations(appSlug);
  }

  @ApiOperation({ summary: 'Emergency revoke an extension across all tenants (G-20)' })
  @Permissions('system.marketplace.write')
  @Post('extensions/:appSlug/emergency-revoke')
  emergencyRevokeExtension(
    @Param('appSlug') appSlug: string,
    @Body() body: { reason: string; actorId?: string }
  ) {
    return this.marketplace.emergencyRevokeExtension(
      appSlug,
      body.reason,
      body?.actorId || 'SUPER_ADMIN'
    );
  }
}
