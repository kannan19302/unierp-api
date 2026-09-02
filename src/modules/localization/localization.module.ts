import { LocalizationGeneratedController } from "./controllers/localization-generated.controller";
import { LocalizationGeneratedService } from "./services/localization-generated.service";
import { Module } from "@nestjs/common";
import { LocalizationController } from "./controllers/localization.controller";
import { LocalizationDeepController } from "./controllers/localization-deep.controller";
import { LocalizationBulkController } from "./controllers/localization-bulk.controller";
import { LocalizationService } from "./services/localization.service";
import { LocalizationContextService } from "./services/localization-context.service";
import { LocalizationGlossaryService } from "./services/localization-glossary.service";
import { LocalizationMemoryService } from "./services/localization-memory.service";
import { LocalizationMachineTranslationService } from "./services/localization-mt.service";
import { LocalizationReviewService } from "./services/localization-review.service";
import { LocalizationFallbackService } from "./services/localization-fallback.service";
import { LocalizationContentScheduleService } from "./services/localization-content-schedule.service";
import { LocalizationRegionValidationService } from "./services/localization-region-validation.service";

import { LocalizationRepository } from "./repositories/localization.repository";

@Module({
  controllers: [
    LocalizationGeneratedController,
    LocalizationController,
    LocalizationDeepController,
    LocalizationBulkController,
  ],
  providers: [
    LocalizationRepository,
    LocalizationGeneratedService,
    LocalizationService,
    LocalizationContextService,
    LocalizationGlossaryService,
    LocalizationMemoryService,
    LocalizationMachineTranslationService,
    LocalizationReviewService,
    LocalizationFallbackService,
    LocalizationContentScheduleService,
    LocalizationRegionValidationService,
  ],
  exports: [LocalizationRepository, LocalizationGeneratedService, LocalizationService],
})
export class LocalizationModule {}
