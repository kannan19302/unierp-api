import { describe, it, expect, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { SubscriptionCouponService } from "../services/subscription-coupon.service";
import { SubscriptionPlanGroupService } from "../services/subscription-plan-group.service";
import { SubscriptionMigrationService } from "../services/subscription-migration.service";
import { SubscriptionDunningService } from "../services/subscription-dunning.service";
import { SubscriptionCreditNoteService } from "../services/subscription-credit-note.service";
import { SubscriptionAutoScaleService } from "../services/subscription-auto-scale.service";

describe("SubscriptionsDeepServices", () => {
  let couponService: SubscriptionCouponService;
  let planGroupService: SubscriptionPlanGroupService;
  let migrationService: SubscriptionMigrationService;
  let dunningService: SubscriptionDunningService;
  let creditNoteService: SubscriptionCreditNoteService;
  let autoScaleService: SubscriptionAutoScaleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionCouponService,
        SubscriptionPlanGroupService,
        SubscriptionMigrationService,
        SubscriptionDunningService,
        SubscriptionCreditNoteService,
        SubscriptionAutoScaleService,
      ],
    }).compile();
    couponService = module.get(SubscriptionCouponService);
    planGroupService = module.get(SubscriptionPlanGroupService);
    migrationService = module.get(SubscriptionMigrationService);
    dunningService = module.get(SubscriptionDunningService);
    creditNoteService = module.get(SubscriptionCreditNoteService);
    autoScaleService = module.get(SubscriptionAutoScaleService);
  });

  it("should be defined", () => {
    expect(couponService).toBeDefined();
    expect(planGroupService).toBeDefined();
    expect(migrationService).toBeDefined();
    expect(dunningService).toBeDefined();
    expect(creditNoteService).toBeDefined();
    expect(autoScaleService).toBeDefined();
  });
});
