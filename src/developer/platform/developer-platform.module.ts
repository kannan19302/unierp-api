import { Module } from "@nestjs/common";
import { DevHomeController } from "./dev-home.controller";
import { DevProjectsService } from "./dev-projects.service";
import { ArtifactRegistryService } from "./artifact-registry.service";
import { LibraryController } from "./library.controller";
import { ProjectArtifactsController } from "./project-artifacts.controller";
import { ProjectReleasesController } from "./project-releases.controller";
import { ProjectReleasesService } from "./project-releases.service";
import { ModuleCompositionService } from "./module-composition.service";
import { ArtifactRevisionsController } from "./artifact-revisions.controller";
import { ArtifactRevisionsService } from "./artifact-revisions.service";
import { BuilderManifestsController } from "./builder-manifests.controller";
import { DeveloperPackagesController } from "./developer-packages.controller";
import { DeveloperPackagesService } from "./developer-packages.service";
import { EnvironmentBindingsController } from "./environment-bindings.controller";
import { EnvironmentBindingsService } from "./environment-bindings.service";
import { RuntimeManifestController } from "./runtime-manifest.controller";
import { RuntimeManifestService } from "./runtime-manifest.service";
import { DeveloperAuthorizationService } from "./developer-authorization.service";
import { ProjectTestRunsController } from "./project-test-runs.controller";
import { ProjectTestRunsService } from "./project-test-runs.service";
import { ProjectSourceExportController } from "./project-source-export.controller";
import { ProjectSourceExportService } from "./project-source-export.service";
import { ProjectGovernorService } from "./project-governor.service";
import { ProjectSourceImportController } from "./project-source-import.controller";
import { ProjectSourceImportService } from "./project-source-import.service";
import { ProjectPreviewController } from "./project-preview.controller";
import { ProjectPreviewResolveController } from "./project-preview-resolve.controller";
import { ProjectPreviewService } from "./project-preview.service";
import { DeveloperAuditController } from "./developer-audit.controller";
import { DeveloperAuditService } from "./developer-audit.service";
import { RuntimeCellRouterService } from "./runtime-cell-router.service";
import { DeveloperBuildsController } from "./developer-builds.controller";
import { DeveloperBuildsService } from "./developer-builds.service";
import { DeveloperBuildProcessor } from "./developer-build.processor";
import { RuntimeCellAssignmentService } from "./runtime-cell-assignment.service";
import { RuntimeCellAssignmentController } from "./runtime-cell-assignment.controller";
import { ProjectChangeSetsController } from "./project-change-sets.controller";
import { ProjectChangeSetsService } from "./project-change-sets.service";
import { DeveloperEntitlementsService } from "./developer-entitlements.service";
import { DeveloperEntitlementsController } from "./developer-entitlements.controller";
import { RuntimePlanCacheService } from "./runtime-plan-cache.service";
import { ProjectPreviewProcessor } from "./project-preview.processor";
import { RuntimePlanCacheInvalidationService } from "./runtime-plan-cache-invalidation.service";
import { DeveloperWorkloadMeteringService } from "./developer-workload-metering.service";
import { PreviewSubmissionsService } from "./preview-submissions.service";
import { ProjectSourceDependencyImportService } from "./project-source-dependency-import.service";

/**
 * The project-first surface: `/api/v1/dev/*`. Sibling of `BuilderModule`
 * (`../builder/builder.module.ts`), not a replacement — see plan phase P1
 * and `data/prisma/schema/developer-platform.prisma`.
 */
@Module({
  controllers: [
    DevHomeController,
    LibraryController,
    ProjectArtifactsController,
    ProjectReleasesController,
    ArtifactRevisionsController,
    BuilderManifestsController,
    DeveloperPackagesController,
    EnvironmentBindingsController,
    RuntimeManifestController,
    ProjectTestRunsController,
    ProjectSourceExportController,
    ProjectSourceImportController,
    ProjectPreviewController,
    ProjectPreviewResolveController,
    DeveloperAuditController,
    DeveloperBuildsController,
    RuntimeCellAssignmentController,
    ProjectChangeSetsController,
    DeveloperEntitlementsController,
  ],
  providers: [
    DevProjectsService,
    ArtifactRegistryService,
    ProjectReleasesService,
    ModuleCompositionService,
    ArtifactRevisionsService,
    DeveloperPackagesService,
    EnvironmentBindingsService,
    RuntimeManifestService,
    DeveloperAuthorizationService,
    ProjectTestRunsService,
    ProjectSourceExportService,
    ProjectGovernorService,
    ProjectSourceImportService,
    ProjectPreviewService,
    PreviewSubmissionsService,
    ProjectSourceDependencyImportService,
    DeveloperAuditService,
    RuntimeCellRouterService,
    RuntimeCellAssignmentService,
    ProjectChangeSetsService,
    DeveloperEntitlementsService,
    RuntimePlanCacheService,
    RuntimePlanCacheInvalidationService,
    DeveloperWorkloadMeteringService,
    DeveloperBuildsService,
    DeveloperBuildProcessor,
    ProjectPreviewProcessor,
  ],
  // Exported so the legacy `BuilderModule` controllers can route their writes
  // through the registry as P4 lands, closing the dual-write window one
  // controller at a time rather than in a single large change.
  exports: [
    DevProjectsService,
    ArtifactRegistryService,
    ProjectReleasesService,
    ModuleCompositionService,
    ArtifactRevisionsService,
    DeveloperPackagesService,
    EnvironmentBindingsService,
    RuntimeManifestService,
    DeveloperAuthorizationService,
    ProjectTestRunsService,
    ProjectSourceExportService,
    ProjectGovernorService,
    ProjectSourceImportService,
    ProjectPreviewService,
    DeveloperAuditService,
    RuntimeCellRouterService,
    RuntimeCellAssignmentService,
    ProjectChangeSetsService,
    DeveloperEntitlementsService,
    RuntimePlanCacheService,
    RuntimePlanCacheInvalidationService,
    DeveloperWorkloadMeteringService,
    DeveloperBuildsService,
  ],
})
export class DeveloperPlatformModule {}
