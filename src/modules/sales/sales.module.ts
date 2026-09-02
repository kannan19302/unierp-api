import { Module, OnModuleInit } from "@nestjs/common";
import { SalesController } from "./controllers/sales.controller";
import { SalesService } from "./services/sales.service";
import { PricingService } from "./services/pricing.service";
import { PricingController } from "./controllers/pricing.controller";
import { SalesCpqService } from "./services/sales-cpq.service";
import { SalesFulfillmentService } from "./services/sales-fulfillment.service";
import { SalesExpansionController } from "./controllers/sales-expansion.controller";
import { SalesOutboxHandler } from "./services/sales-outbox.handler";
import { OutboxHandlerRegistry } from "../../platform/outbox/outbox-handler.registry";
import { OutboxService } from "../../common/outbox";
import { OutboxModule } from "../../platform/outbox/outbox.module";
import { SalesRepository } from "./repositories/sales.repository";

import { SalesPromotionsService } from "./services/sales-promotions.service";
import { SalesPromotionsController } from "./controllers/sales-promotions.controller";
import { SalesPartnersService } from "./services/sales-partners.service";
import { SalesPartnersController } from "./controllers/sales-partners.controller";
import { SalesContractsService } from "./services/sales-contracts.service";
import { SalesContractsController } from "./controllers/sales-contracts.controller";
import { SalesCommissionsService } from "./services/sales-commissions.service";
import { SalesCommissionsController } from "./controllers/sales-commissions.controller";
import { SalesAnalyticsService } from "./services/sales-analytics.service";
import { SalesAnalyticsController } from "./controllers/sales-analytics.controller";
import { SalesForecastingService } from "./services/sales-forecasting.service";
import { SalesForecastingController } from "./controllers/sales-forecasting.controller";
import { SalesSubscriptionService } from "./services/sales-subscription.service";
import { SalesSubscriptionController } from "./controllers/sales-subscription.controller";
import { SalesSpiffService } from "./services/sales-spiff.service";
import { SalesSpiffController } from "./controllers/sales-spiff.controller";
import { SalesAdvancedPricingService } from "./services/sales-advanced-pricing.service";
import { SalesAdvancedPricingController } from "./controllers/sales-advanced-pricing.controller";
import { SalesCpqController } from "./controllers/sales-cpq.controller";
import { SalesCpqExtensionService } from "./services/sales-cpq-extension.service";
import { SalesTerritoryService } from "./services/sales-territory.service";
import { SalesTerritoryController } from "./controllers/sales-territory.controller";
import { SalesCustomerSuccessService } from "./services/sales-customer-success.service";
import { SalesCustomerSuccessController } from "./controllers/sales-customer-success.controller";
import { SalesPlaybooksDeepService } from "./services/sales-playbooks-deep.service";
import { SalesPlaybooksDeepController } from "./controllers/sales-playbooks-deep.controller";
import { SalesIntelligenceSignalsService } from "./services/sales-intelligence-signals.service";
import { SalesIntelligenceSignalsController } from "./controllers/sales-intelligence-signals.controller";
import { SalesDocumentsDeepService } from "./services/sales-documents-deep.service";
import { SalesDocumentsDeepController } from "./controllers/sales-documents-deep.controller";
import { DocumentTemplateEngineService } from "./services/document-template-engine.service";
import { SalesReturnsService } from "./services/sales-returns.service";
import { SalesReturnsController } from "./controllers/sales-returns.controller";
import { SalesGamificationDeepService } from "./services/sales-gamification-deep.service";
import { SalesGamificationDeepController } from "./controllers/sales-gamification-deep.controller";
import { SalesAdvancedPricingDeepService } from "./services/sales-advanced-pricing-deep.service";
import { SalesAdvancedPricingDeepController } from "./controllers/sales-advanced-pricing-deep.controller";
import { SalesEnterpriseExecutionDeepService } from "./services/sales-enterprise-execution-deep.service";
import { SalesEnterpriseExecutionDeepController } from "./controllers/sales-enterprise-execution-deep.controller";
import { SalesQuoteCpqMasterDeepService } from "./services/sales-quote-cpq-master-deep.service";
import { SalesQuoteCpqMasterDeepController } from "./controllers/sales-quote-cpq-master-deep.controller";
import { SalesOmnichannelDealsDeepService } from "./services/sales-omnichannel-deals-deep.service";
import { SalesOmnichannelDealsDeepController } from "./controllers/sales-omnichannel-deals-deep.controller";
import { SalesGlobalRevenueOpsDeepService } from "./services/sales-global-revenue-ops-deep.service";
import { SalesGlobalRevenueOpsDeepController } from "./controllers/sales-global-revenue-ops-deep.controller";
import { SalesAdvancedEnterpriseCoreDeepService } from "./services/sales-advanced-enterprise-core-deep.service";
import { SalesAdvancedEnterpriseCoreDeepController } from "./controllers/sales-advanced-enterprise-core-deep.controller";
import { SalesEnterpriseController } from "./controllers/sales-enterprise.controller";
import { SalesEnterpriseService } from "./services/sales-enterprise.service";
import { SalesEnterpriseModule } from "./sales-enterprise.module";

@Module({
  imports: [OutboxModule, SalesEnterpriseModule],
  controllers: [
    SalesController,
    PricingController,
    SalesExpansionController,
    SalesPromotionsController,
    SalesPartnersController,
    SalesContractsController,
    SalesCommissionsController,
    SalesAnalyticsController,
    SalesForecastingController,
    SalesSubscriptionController,
    SalesSpiffController,
    SalesAdvancedPricingController,
    SalesCpqController,
    SalesTerritoryController,
    SalesCustomerSuccessController,
    SalesPlaybooksDeepController,
    SalesIntelligenceSignalsController,
    SalesDocumentsDeepController,
    SalesReturnsController,
    SalesGamificationDeepController,
    SalesAdvancedPricingDeepController,
    SalesEnterpriseExecutionDeepController,
    SalesQuoteCpqMasterDeepController,
    SalesOmnichannelDealsDeepController,
    SalesGlobalRevenueOpsDeepController,
    SalesAdvancedEnterpriseCoreDeepController,
    SalesEnterpriseController,
  ],
  providers: [
    SalesRepository,
    SalesService,
    PricingService,
    SalesCpqService,
    SalesFulfillmentService,
    SalesOutboxHandler,
    SalesPromotionsService,
    SalesPartnersService,
    SalesContractsService,
    SalesCommissionsService,
    SalesAnalyticsService,
    SalesForecastingService,
    SalesSubscriptionService,
    SalesSpiffService,
    SalesAdvancedPricingService,
    SalesCpqExtensionService,
    SalesTerritoryService,
    SalesCustomerSuccessService,
    SalesPlaybooksDeepService,
    SalesIntelligenceSignalsService,
    SalesDocumentsDeepService,
    DocumentTemplateEngineService,
    SalesReturnsService,
    SalesGamificationDeepService,
    SalesAdvancedPricingDeepService,
    SalesEnterpriseExecutionDeepService,
    SalesQuoteCpqMasterDeepService,
    SalesOmnichannelDealsDeepService,
    SalesGlobalRevenueOpsDeepService,
    SalesAdvancedEnterpriseCoreDeepService,
    SalesEnterpriseService,
  ],
  exports: [
    SalesRepository,
    SalesService,
    PricingService,
    SalesCpqService,
    SalesFulfillmentService,
    SalesSubscriptionService,
    SalesSpiffService,
    SalesAdvancedPricingService,
    SalesCpqExtensionService,
    SalesTerritoryService,
    SalesCustomerSuccessService,
    SalesPlaybooksDeepService,
    SalesIntelligenceSignalsService,
    SalesDocumentsDeepService,
    SalesReturnsService,
    SalesGamificationDeepService,
    SalesAdvancedPricingDeepService,
    SalesEnterpriseExecutionDeepService,
    SalesQuoteCpqMasterDeepService,
    SalesOmnichannelDealsDeepService,
    SalesGlobalRevenueOpsDeepService,
    SalesAdvancedEnterpriseCoreDeepService,
    SalesEnterpriseService,
  ],
})
export class SalesModule implements OnModuleInit {
  constructor(
    private readonly outboxHandlerRegistry: OutboxHandlerRegistry,
    private readonly outboxService: OutboxService,
    private readonly salesOutboxHandler: SalesOutboxHandler,
  ) {}

  onModuleInit(): void {
    this.outboxService.registerDestination(
      "ecommerce.checkout.completed",
      this.salesOutboxHandler.destination,
    );
    this.outboxHandlerRegistry.register(
      this.salesOutboxHandler.destination,
      (event) => this.salesOutboxHandler.handle(event),
    );
  }
}
