import { Module } from "@nestjs/common";
import { OutboxModule } from "../../platform/outbox/outbox.module";
import { EcommerceAdminController } from "./controllers/ecommerce-admin.controller";
import { EcommerceAdminService } from "./services/ecommerce-admin.service";
import { EcommercePublicController } from "./controllers/ecommerce-public.controller";
import { EcommercePublicService } from "./services/ecommerce-public.service";
import { EcommerceCheckoutService } from "./services/ecommerce-checkout.service";
import { EcommerceExpansionController } from "./controllers/ecommerce-expansion.controller";
import { EcommerceExpansionService } from "./services/ecommerce-expansion.service";
import { EcommerceEnterpriseModule } from "./ecommerce-enterprise.module";
import { MockPaymentGatewayService } from "./services/mock-payment-gateway.service";
import { StripePaymentGatewayService } from "./services/stripe-payment-gateway.service";
import { PlatformCredentialsModule } from "../../common/platform-credentials/platform-credentials.module";

import { EcommerceRepository } from "./repositories/ecommerce.repository";

/**
 * E-Commerce Storefront module (module #33). See
 * .ai/ECOMMERCE_MODULE_REQUIREMENTS.md and .ai/DATA_MODEL.md Section 3.4.
 *
 * Track D (#22): The synchronous SalesService import has been removed.  The
 * checkout flow now writes a `StorefrontCheckoutState` row and an outbox
 * event (`ecommerce.checkout.completed`) inside a single transaction.  The
 * Sales consumer handler processes the event asynchronously.
 */
@Module({
  imports: [OutboxModule, PlatformCredentialsModule, EcommerceEnterpriseModule],
  controllers: [
    EcommerceAdminController,
    EcommercePublicController,
    EcommerceExpansionController,
  ],
  providers: [
    EcommerceRepository,
    EcommerceAdminService,
    EcommercePublicService,
    EcommerceCheckoutService,
    EcommerceExpansionService,
    MockPaymentGatewayService,
    StripePaymentGatewayService,
    {
      provide: "PAYMENT_GATEWAY",
      useFactory: (
        stripeService: StripePaymentGatewayService,
        mockService: MockPaymentGatewayService,
      ) => {
        // Transparent fallback to Mock gateway if Stripe variables are missing
        const hasStripeKey =
          process.env.STRIPE_SECRET_KEY &&
          process.env.STRIPE_SECRET_KEY.trim().length > 0;
        return hasStripeKey ? stripeService : mockService;
      },
      inject: [StripePaymentGatewayService, MockPaymentGatewayService],
    },
  ],
  exports: [
    EcommerceRepository,
    EcommerceAdminService,
    EcommercePublicService,
    EcommerceExpansionService,
    "PAYMENT_GATEWAY",
  ],
})
export class EcommerceModule {}
