import { SavedViewsGeneratedController } from "./controllers/saved-views-generated.controller";
import { SavedViewsGeneratedService } from "./services/saved-views-generated.service";
import { Module } from "@nestjs/common";
import { SavedViewsController } from "./controllers/saved-views.controller";
import { SavedViewsService } from "./services/saved-views.service";
import { SavedViewsDeepService } from "./services/saved-views-deep.service";
import { SavedViewsSharingService } from "./services/saved-views-sharing.service";
import { SavedViewsFiltersService } from "./services/saved-views-filters.service";

import { SavedViewsRepository } from "./repositories/saved-views.repository";

@Module({
  controllers: [SavedViewsGeneratedController, SavedViewsController],
  providers: [
    SavedViewsRepository,
    SavedViewsGeneratedService,
    SavedViewsService,
    SavedViewsDeepService,
    SavedViewsSharingService,
    SavedViewsFiltersService,
  ],
  exports: [
    SavedViewsRepository,
    SavedViewsGeneratedService,
    SavedViewsService,
    SavedViewsDeepService,
    SavedViewsSharingService,
    SavedViewsFiltersService,
  ],
})
export class SavedViewsModule {}
