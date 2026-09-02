import { describe, it, expect, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { LocalizationContextService } from "../services/localization-context.service";
import { LocalizationGlossaryService } from "../services/localization-glossary.service";
import { LocalizationMemoryService } from "../services/localization-memory.service";
import { LocalizationMachineTranslationService } from "../services/localization-mt.service";
import { LocalizationReviewService } from "../services/localization-review.service";
import { LocalizationFallbackService } from "../services/localization-fallback.service";
import { LocalizationContentScheduleService } from "../services/localization-content-schedule.service";
import { LocalizationRegionValidationService } from "../services/localization-region-validation.service";

describe("LocalizationDeepServices", () => {
  let ctxService: LocalizationContextService;
  let glossaryService: LocalizationGlossaryService;
  let memoryService: LocalizationMemoryService;
  let mtService: LocalizationMachineTranslationService;
  let reviewService: LocalizationReviewService;
  let fallbackService: LocalizationFallbackService;
  let scheduleService: LocalizationContentScheduleService;
  let regionService: LocalizationRegionValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalizationContextService,
        LocalizationGlossaryService,
        LocalizationMemoryService,
        LocalizationMachineTranslationService,
        LocalizationReviewService,
        LocalizationFallbackService,
        LocalizationContentScheduleService,
        LocalizationRegionValidationService,
      ],
    }).compile();
    ctxService = module.get(LocalizationContextService);
    glossaryService = module.get(LocalizationGlossaryService);
    memoryService = module.get(LocalizationMemoryService);
    mtService = module.get(LocalizationMachineTranslationService);
    reviewService = module.get(LocalizationReviewService);
    fallbackService = module.get(LocalizationFallbackService);
    scheduleService = module.get(LocalizationContentScheduleService);
    regionService = module.get(LocalizationRegionValidationService);
  });

  it("should be defined", () => {
    expect(ctxService).toBeDefined();
    expect(glossaryService).toBeDefined();
    expect(memoryService).toBeDefined();
    expect(mtService).toBeDefined();
    expect(reviewService).toBeDefined();
    expect(fallbackService).toBeDefined();
    expect(scheduleService).toBeDefined();
    expect(regionService).toBeDefined();
  });
});
