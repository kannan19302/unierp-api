import { Module } from "@nestjs/common";
import { OutboxModule } from "../../platform/outbox/outbox.module";
import { CloseSlaRepository } from "./repositories/close-sla.repository";
import { AdvancedFinanceController } from "./controllers/advanced-finance.controller";
import { OpeningBalanceMigrationController } from "./controllers/opening-balance-migration.controller";
import { OpeningBalanceMigrationService } from "./services/opening-balance-migration.service";

import { FinanceExpansionDeepController } from "./controllers/finance-expansion-deep.controller";
import { FinanceMoreDeepController } from "./controllers/finance-more-deep.controller";
import { FinanceTaxJournalDeepController } from "./controllers/finance-tax-journal-deep.controller";
import { EInvoiceController } from "./controllers/e-invoice.controller";
import { TreasuryDeepController } from "./controllers/treasury-deep.controller";
import { SubscriptionBillingController } from "./controllers/subscription-billing.controller";
import { FixedAssetDeepController } from "./controllers/fixed-asset-deep.controller";
import { Asc606DeepController } from "./controllers/asc606-deep.controller";
import { GlobalTaxDeepController } from "./controllers/global-tax-deep.controller";
import { FinancialInstrumentsController } from "./controllers/financial-instruments.controller";
import { BudgetDeepController } from "./controllers/budget-deep.controller";
import { NettingDeepController } from "./controllers/netting-deep.controller";
import { WorkingCapitalController } from "./controllers/working-capital.controller";
import { CloseManagementController } from "./controllers/close-management.controller";
import { ConsolidationV2Controller } from "./controllers/consolidation-v2.controller";
import { RiskManagementController } from "./controllers/risk-management.controller";
import { EsgAccountingController } from "./controllers/esg-accounting.controller";
import { TaxProvisioningController } from "./controllers/tax-provisioning.controller";
import { ApAutomationController } from "./controllers/ap-automation.controller";
import { AiAnalyticsController } from "./controllers/ai-analytics.controller";
import { ArCreditManagementController } from "./controllers/ar-credit-management.controller";
import { AdvancedFinanceService } from "./services/advanced-finance.service";
import { FinanceExpansionDeepService } from "./services/finance-expansion-deep.service";
import { PeriodCloseGuardService } from "../../common/finance/period-close-guard.service";
import {
  GlAccountingService,
  BudgetingService,
  BankingService,
  ExpenseManagementService,
  RevenueRecognitionService,
  TaxEngineService,
  TreasuryService,
  ConsolidationService,
  FinancialReportingService,
  PeriodManagementService,
  PaymentTermsService,
  BankFeedsService,
  BankStatementParserService,
  CashFlowForecastService,
  InterCompanyService,
  FxRevaluationService,
  PayablesService,
  FpaService,
  InvoiceCaptureService,
  CardSpendLimitService,
  AllocationService,
  BudgetControlService,
  BudgetReallocationService,
  IntercompanyLoansService,
  AssetLifecycleService,
  CashPoolingService,
  ConsolidationDeepService,
  Form1099Service,
  TaxJurisdictionLookupService,
  TaxFilingCalendarService,
  RecurringJournalSchedulerService,
  SubledgerInvariantService,
  Iso20022PaymentGeneratorService,
  SoxComplianceService,
  Asc606DeepService,
  GlobalTaxDeepService,
  FinancialInstrumentsService,
  BudgetDeepService,
  NettingDeepService,
} from "./services/index";
import { TaxEngineDeepService } from "./services/tax-engine-deep.service";
import { TreasuryDeepService } from "./services/treasury-deep.service";
import { ApIntelligenceService } from "./services/ap-intelligence.service";
import { ArCollectionsService } from "./services/ar-collections.service";
import { FixedAssetDeepService } from "./services/fixed-asset-deep.service";
import { FpaDeepService } from "./services/fpa-deep.service";
import { RevenueBillingService } from "./services/revenue-billing.service";
import { ComplianceControlsService } from "./services/compliance-controls.service";
import { EconomicNexusService } from "./services/economic-nexus.service";
import { WorkingCapitalService } from "./services/working-capital.service";
import { CloseManagementService } from "./services/close-management.service";
import { ConsolidationV2Service } from "./services/consolidation-v2.service";
import { RiskManagementService } from "./services/risk-management.service";
import { EsgAccountingService } from "./services/esg-accounting.service";
import { TaxProvisioningService } from "./services/tax-provisioning.service";
import { ApAutomationService } from "./services/ap-automation.service";
import { AiAnalyticsService } from "./services/ai-analytics.service";
import { ArCreditManagementService } from "./services/ar-credit-management.service";
import { AdvancedFinanceRepository } from "./repositories/advanced-finance.repository";

const domainServices = [
  GlAccountingService,
  OpeningBalanceMigrationService,
  BudgetingService,
  BankingService,
  CardSpendLimitService,
  ExpenseManagementService,
  RevenueRecognitionService,
  TaxEngineService,
  TreasuryService,
  ConsolidationService,
  FinancialReportingService,
  PeriodManagementService,
  PaymentTermsService,
  BankFeedsService,
  CashFlowForecastService,
  InterCompanyService,
  FxRevaluationService,
  PayablesService,
  FpaService,
  InvoiceCaptureService,
  AllocationService,
  BudgetControlService,
  BudgetReallocationService,
  // Big-phase batch services
  TaxEngineDeepService,
  TreasuryDeepService,
  ApIntelligenceService,
  ArCollectionsService,
  FixedAssetDeepService,
  FpaDeepService,
  RevenueBillingService,
  ComplianceControlsService,
  // New Phase M services
  Asc606DeepService,
  GlobalTaxDeepService,
  FinancialInstrumentsService,
  BudgetDeepService,
  NettingDeepService,
  // Hardening services
  IntercompanyLoansService,
  AssetLifecycleService,
  CashPoolingService,
  ConsolidationDeepService,
  Form1099Service,
  EconomicNexusService,
  FinanceExpansionDeepService,
  TaxJurisdictionLookupService,
  TaxFilingCalendarService,
  RecurringJournalSchedulerService,
  SubledgerInvariantService,
  Iso20022PaymentGeneratorService,
  WorkingCapitalService,
  CloseManagementService,
  ConsolidationV2Service,
  RiskManagementService,
  EsgAccountingService,
  TaxProvisioningService,
  ApAutomationService,
  AiAnalyticsService,
  ArCreditManagementService,
  SoxComplianceService,
  BankStatementParserService,
];

@Module({
  imports: [OutboxModule],
  controllers: [
    AdvancedFinanceController,
    OpeningBalanceMigrationController,

    FinanceExpansionDeepController,
    FinanceMoreDeepController,
    FinanceTaxJournalDeepController,
    EInvoiceController,
    TreasuryDeepController,
    SubscriptionBillingController,
    FixedAssetDeepController,
    Asc606DeepController,
    GlobalTaxDeepController,
    FinancialInstrumentsController,
    BudgetDeepController,
    NettingDeepController,
    WorkingCapitalController,
    CloseManagementController,
    ConsolidationV2Controller,
    RiskManagementController,
    EsgAccountingController,
    TaxProvisioningController,
    ApAutomationController,
    AiAnalyticsController,
    ArCreditManagementController,
  ],
  providers: [AdvancedFinanceRepository, CloseSlaRepository, AdvancedFinanceService, PeriodCloseGuardService, ...domainServices],
  exports: [AdvancedFinanceRepository, CloseSlaRepository, AdvancedFinanceService, PeriodCloseGuardService, ...domainServices],
})
export class AdvancedFinanceModule {}
