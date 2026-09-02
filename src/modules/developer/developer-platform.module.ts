import { Module } from "@nestjs/common";
import { DevHomeController } from "./controllers/dev-home.controller";
import { DevProjectsService } from "./services/dev-projects.service";
import { ArtifactRegistryService } from "./services/artifact-registry.service";
import { LibraryController } from "./controllers/library.controller";
import { ProjectArtifactsController } from "./controllers/project-artifacts.controller";
import { ProjectReleasesController } from "./controllers/project-releases.controller";
import { ProjectReleasesService } from "./services/project-releases.service";
import { ModuleCompositionService } from "./services/module-composition.service";
import { ArtifactRevisionsController } from "./controllers/artifact-revisions.controller";
import { ArtifactRevisionsService } from "./services/artifact-revisions.service";
import { BuilderManifestsController } from "./controllers/builder-manifests.controller";
import { DeveloperPackagesController } from "./controllers/developer-packages.controller";
import { DeveloperPackagesService } from "./services/developer-packages.service";
import { EnvironmentBindingsController } from "./controllers/environment-bindings.controller";
import { EnvironmentBindingsService } from "./services/environment-bindings.service";
import { RuntimeManifestController } from "./controllers/runtime-manifest.controller";
import { RuntimeManifestService } from "./services/runtime-manifest.service";
import { DeveloperAuthorizationService } from "./services/developer-authorization.service";
import { ProjectTestRunsController } from "./controllers/project-test-runs.controller";
import { ProjectTestRunsService } from "./services/project-test-runs.service";
import { ProjectSourceExportController } from "./controllers/project-source-export.controller";
import { ProjectSourceExportService } from "./services/project-source-export.service";
import { ProjectGovernorService } from "./services/project-governor.service";
import { ProjectSourceImportController } from "./controllers/project-source-import.controller";
import { ProjectSourceImportService } from "./services/project-source-import.service";
import { ProjectPreviewController } from "./controllers/project-preview.controller";
import { ProjectPreviewResolveController } from "./controllers/project-preview-resolve.controller";
import { ProjectPreviewService } from "./services/project-preview.service";
import { DeveloperAuditController } from "./controllers/developer-audit.controller";
import { DeveloperAuditService } from "./services/developer-audit.service";
import { RuntimeCellRouterService } from "./services/runtime-cell-router.service";
import { DeveloperBuildsController } from "./controllers/developer-builds.controller";
import { DeveloperBuildsService } from "./services/developer-builds.service";
import { DeveloperBuildProcessor } from "./services/developer-build.processor";
import { RuntimeCellAssignmentService } from "./services/runtime-cell-assignment.service";
import { RuntimeCellAssignmentController } from "./controllers/runtime-cell-assignment.controller";
import { ProjectChangeSetsController } from "./controllers/project-change-sets.controller";
import { ProjectChangeSetsService } from "./services/project-change-sets.service";
import { DeveloperEntitlementsService } from "./services/developer-entitlements.service";
import { DeveloperEntitlementsController } from "./controllers/developer-entitlements.controller";
import { RuntimePlanCacheService } from "./services/runtime-plan-cache.service";
import { ProjectPreviewProcessor } from "./services/project-preview.processor";
import { RuntimePlanCacheInvalidationService } from "./services/runtime-plan-cache-invalidation.service";
import { DeveloperWorkloadMeteringService } from "./services/developer-workload-metering.service";
import { PreviewSubmissionsService } from "./services/preview-submissions.service";
import { ProjectSourceDependencyImportService } from "./services/project-source-dependency-import.service";

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
