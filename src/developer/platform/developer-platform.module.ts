import { Module } from "@nestjs/common";
import { DevHomeController } from "./dev-home.controller";
import { DevProjectsService } from "./dev-projects.service";
import { ArtifactRegistryService } from "./artifact-registry.service";
import { LibraryController } from "./library.controller";
import { ProjectArtifactsController } from "./project-artifacts.controller";
import { ProjectReleasesController } from "./project-releases.controller";
import { ProjectReleasesService } from "./project-releases.service";
import { ModuleCompositionService } from "./module-composition.service";

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
  ],
  providers: [
    DevProjectsService,
    ArtifactRegistryService,
    ProjectReleasesService,
    ModuleCompositionService,
  ],
  // Exported so the legacy `BuilderModule` controllers can route their writes
  // through the registry as P4 lands, closing the dual-write window one
  // controller at a time rather than in a single large change.
  exports: [
    DevProjectsService,
    ArtifactRegistryService,
    ProjectReleasesService,
    ModuleCompositionService,
  ],
})
export class DeveloperPlatformModule {}
