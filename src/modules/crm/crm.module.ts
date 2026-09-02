import { Module } from "@nestjs/common";
import { CrmController } from "./controllers/crm.controller";
import { CrmService } from "./services/crm.service";
import { CrmIntegrationsService } from "./services/crm-integrations.service";
import { CrmCustomersService } from "./services/crm-customers.service";
import { CrmContactsService } from "./services/crm-contacts.service";
import { CrmLeadsService } from "./services/crm-leads.service";
import { CrmDealsService } from "./services/crm-deals.service";
import { CrmActivitiesService } from "./services/crm-activities.service";
import { CrmMarketingService } from "./services/crm-marketing.service";
import { CrmEnterpriseModule } from "./crm-enterprise.module";
import { CrmSalesOpsService } from "./services/crm-salesops.service";
import { CrmConfigService } from "./services/crm-config.service";
import { CrmCollaborationService } from "./services/crm-collaboration.service";
import { CrmDashboardsService } from "./services/crm-dashboards.service";
import { CrmCasesService } from "./services/crm-cases.service";
import { CrmLeadScoringService } from "./services/crm-lead-scoring.service";
import { CrmLeadScoringController } from "./controllers/crm-lead-scoring.controller";
import { CrmDuplicatesService } from "./services/crm-duplicates.service";
import { CrmDuplicatesController } from "./controllers/crm-duplicates.controller";
import { CrmPipelineStagesService } from "./services/crm-pipeline-stages.service";
import { CrmPipelineStagesController } from "./controllers/crm-pipeline-stages.controller";
import { CrmSegmentsService } from "./services/crm-segments.service";
import { CrmSegmentsController } from "./controllers/crm-segments.controller";
import { CrmSlaService } from "./services/crm-sla.service";
import { CrmSlaController } from "./controllers/crm-sla.controller";
import { CrmIntelligenceService } from "./services/crm-intelligence.service";
import { CrmIntelligenceController } from "./controllers/crm-intelligence.controller";
import { CrmContractsService } from "./services/crm-contracts.service";
import { CrmContractsController } from "./controllers/crm-contracts.controller";
import { CrmMailboxService } from "./services/crm-mailbox.service";
import { CrmMailboxProviderClientService } from "./services/crm-mailbox-provider-client.service";
import { CrmMailboxController } from "./controllers/crm-mailbox.controller";
import { CrmExpansionController } from "./controllers/crm-expansion.controller";
import { CustomerPortalService } from "./services/customer-portal.service";
import { CustomerPortalAdminController } from "./controllers/customer-portal-admin.controller";
import { CustomerPortalController } from "./controllers/customer-portal.controller";
import { CrmSettingsController } from "./controllers/settings.controller";
import { CrmCpqService } from "./services/crm-cpq.service";
import { CrmCpqController } from "./controllers/crm-cpq.controller";
import { AppSettingsService } from "../../common/settings/settings.service";
import { CrmExpansionV1Service } from "./services/crm-expansion-v1.service";
import { CrmExpansionV1Controller } from "./controllers/crm-expansion-v1.controller";

import { CrmForecastingService } from "./services/crm-forecasting.service";
import { CrmAccountManagementService } from "./services/crm-account-management.service";
import { CrmCampaignManagementService } from "./services/crm-campaign-management.service";
import { CrmSupportService } from "./services/crm-support.service";
import { CrmEnablementService } from "./services/crm-enablement.service";
import { CrmRevOpsService } from "./services/crm-revops.service";
import { CrmPartnersService } from "./services/crm-partners.service";
import { CrmAutomationService } from "./services/crm-automation.service";
import { CrmTerritoryRulesService } from "./services/crm-territory-rules.service";
import { CrmTerritoryRulesController } from "./controllers/crm-territory-rules.controller";
import { CrmCadencesService } from "./services/crm-cadences.service";
import { CrmCadencesController } from "./controllers/crm-cadences.controller";
import { CrmQuoteSignatureService } from "./services/crm-quote-signature.service";
import {
  CrmQuoteSignatureController,
  CrmQuoteSignaturePublicController,
} from "./controllers/crm-quote-signature.controller";
import { CrmPipelineRiskService } from "./services/crm-pipeline-risk.service";
import { CrmPipelineRiskController } from "./controllers/crm-pipeline-risk.controller";
import { CrmPortalPaymentGatewayService } from "./services/crm-portal-payment-gateway.service";
import { CrmPortalDocumentsService } from "./services/crm-portal-documents.service";
import { CrmRevenueIntelligenceService } from "./services/crm-revenue-intelligence.service";
import { CrmRevenueIntelligenceController } from "./controllers/crm-revenue-intelligence.controller";
import { CrmConversationIntelligenceService } from "./services/crm-conversation-intelligence.service";
import { CrmConversationIntelligenceController } from "./controllers/crm-conversation-intelligence.controller";
import { CrmConversionAnalyticsService } from "./services/crm-conversion-analytics.service";
import { CrmConversionAnalyticsController } from "./controllers/crm-conversion-analytics.controller";
import { CrmAiDraftingService } from "./services/crm-ai-drafting.service";
import { CrmAiDraftingController } from "./controllers/crm-ai-drafting.controller";
import { CrmGamificationService } from "./services/crm-gamification.service";
import { CrmGamificationController } from "./controllers/crm-gamification.controller";
import { CrmCommissionAutomationService } from "./services/crm-commission-automation.service";
import { CrmCommissionAutomationController } from "./controllers/crm-commission-automation.controller";
import { CrmCoachingService } from "./services/crm-coaching.service";
import { CrmCoachingController } from "./controllers/crm-coaching.controller";
import { CrmDealRoomService } from "./services/crm-deal-room.service";
import {
  CrmDealRoomController,
  CrmDealRoomPublicController,
} from "./controllers/crm-deal-room.controller";
import { CrmSalesAutomationService } from "./services/crm-sales-automation.service";
import { CrmCustomerSuccessService } from "./services/crm-customer-success.service";
import { CrmMarketingAutomationService } from "./services/crm-marketing-automation.service";

import { CrmExpansionDeepController } from "./controllers/crm-expansion-deep.controller";
import { CrmActivityCaptureService } from "./services/crm-activity-capture.service";
import { CrmActivityCaptureController } from "./controllers/crm-activity-capture.controller";
import { CrmMarketingDeepService } from "./services/crm-marketing-deep.service";
import { CrmMarketingDeepController } from "./controllers/crm-marketing-deep.controller";

import { CrmLeadEnrichmentService } from "./services/crm-lead-enrichment.service";
import {
  CrmLeadEnrichmentSourceController,
  CrmLeadEnrichmentRuleController,
  CrmLeadEnrichmentFieldMappingController,
  CrmLeadEnrichmentExecutionController,
  CrmLeadEnrichmentScheduleController,
  CrmLeadEnrichmentAnalyticsController,
} from "./controllers/crm-lead-enrichment.controller";
import { CrmGuidedSellingService } from "./services/crm-guided-selling.service";
import {
  CrmNextBestActionConfigController,
  CrmGuidedSellingSuggestionController,
  CrmGuidedSellingPlaybookController,
  CrmGuidedSellingDealReadinessController,
  CrmGuidedSellingAnalyticsController,
} from "./controllers/crm-guided-selling.controller";
import { CrmContractLifecycleService } from "./services/crm-contract-lifecycle.service";
import {
  CrmContractAmendmentController,
  CrmContractPriceEscalationController,
  CrmContractAutoRenewalController,
  CrmContractExpirationPipelineController,
  CrmContractTemplateController,
  CrmContractClauseController,
  CrmContractLifecycleAnalyticsController,
} from "./controllers/crm-contract-lifecycle.controller";

import { CrmCommunicationService } from "./services/crm-communication.service";
import {
  CrmCommunicationChannelController,
  CrmCommunicationTemplateController,
  CrmCommunicationLogController,
} from "./controllers/crm-communication.controller";
import { CrmKnowledgeBaseService } from "./services/crm-knowledge-base.service";
import {
  CrmKnowledgeBaseCategoryController,
  CrmKnowledgeBaseArticleController,
} from "./controllers/crm-knowledge-base.controller";
import { CrmPartnerDeepService } from "./services/crm-partner-deep.service";
import {
  CrmPartnerDealRegistrationController,
  CrmPartnerMdfController,
} from "./controllers/crm-partner-deep.controller";
import { CrmPartnerDeepTwoService } from "./services/crm-partner-deep-two.service";
import { CrmPartnerDeepTwoController } from "./controllers/crm-partner-deep-two.controller";
import { CrmIntegrationDeepService } from "./services/crm-integration-deep.service";
import { CrmIntegrationDeepController } from "./controllers/crm-integration-deep.controller";
import { CrmPipelineDeepService } from "./services/crm-pipeline-deep.service";
import { CrmPipelineDeepController } from "./controllers/crm-pipeline-deep.controller";
import { CrmAbmOrchestrationService } from "./services/crm-abm-orchestration.service";
import { CrmAbmOrchestrationController } from "./controllers/crm-abm-orchestration.controller";
import { CrmChannelPortalDeepService } from "./services/crm-channel-portal-deep.service";
import { CrmWinLossService } from "./services/crm-win-loss.service";
import { CrmWinLossController } from "./controllers/crm-win-loss.controller";
import { CrmForecastGovernanceService } from "./services/crm-forecast-governance.service";
import { CrmDealDeskService } from "./services/crm-deal-desk.service";
import { CrmDealDeskController } from "./controllers/crm-deal-desk.controller";
import { CrmSupportDeepController } from "./controllers/crm-support-deep.controller";
import { CrmPortalDeepController } from "./controllers/crm-portal-deep.controller";
import { CrmCustomerJourneyService } from "./services/crm-customer-journey.service";
import { CrmCustomerJourneyController } from "./controllers/crm-customer-journey.controller";
import { CrmSupportDeepService } from "./services/crm-support-deep.service";
import { CrmPortalDeepService } from "./services/crm-portal-deep.service";
import { CrmContentManagementService } from "./services/crm-content-management.service";
import { CrmContentManagementController } from "./controllers/crm-content-management.controller";
import { CrmDataManagementService } from "./services/crm-data-management.service";
import { CrmDataManagementController } from "./controllers/crm-data-management.controller";
import { CrmTerritoryDeepService } from "./services/crm-territory-deep.service";
import { CrmReportingDeepService } from "./services/crm-reporting-deep.service";
import { CrmTerritoryDeepController } from "./controllers/crm-territory-deep.controller";
import { CrmReportingDeepController } from "./controllers/crm-reporting-deep.controller";
import { CrmAiIntelligenceService } from "./services/crm-ai-intelligence.service";
import { CrmAiIntelligenceController } from "./controllers/crm-ai-intelligence.controller";
import { CrmCompetitorIntelligenceService } from "./services/crm-competitor-intelligence.service";
import { CrmCompetitorIntelligenceController } from "./controllers/crm-competitor-intelligence.controller";
import { CrmCommunicationDeepService } from "./services/crm-communication-deep.service";
import { CrmCommunicationDeepController } from "./controllers/crm-communication-deep.controller";
import { CrmContractDeepService } from "./services/crm-contract-deep.service";
import { CrmContractDeepController } from "./controllers/crm-contract-deep.controller";
import { CrmGamificationDeepService } from "./services/crm-gamification-deep.service";
import { CrmGamificationDeepController } from "./controllers/crm-gamification-deep.controller";
import { CrmCoachingDeepService } from "./services/crm-coaching-deep.service";
import { CrmCoachingDeepController } from "./controllers/crm-coaching-deep.controller";
import { CrmCustomerSuccessDeepService } from "./services/crm-crm-customer-success-deep.service";
import { CrmCustomerSuccessDeepController } from "./controllers/crm-customer-success-deep.controller";
import { CrmAccountHierarchiesDeepService } from "./services/crm-account-hierarchies-deep.service";
import { CrmAccountHierarchiesDeepController } from "./controllers/crm-account-hierarchies-deep.controller";
import { CrmDealAnalyticsDeepService } from "./services/crm-deal-analytics-deep.service";
import { CrmDealAnalyticsDeepController } from "./controllers/crm-deal-analytics-deep.controller";
import { CrmAccountIntelligenceDeepService } from "./services/crm-account-intelligence-deep.service";
import { CrmAccountIntelligenceDeepController } from "./controllers/crm-account-intelligence-deep.controller";
import { CrmMarketingRoiDeepService } from "./services/crm-marketing-roi-deep.service";
import { CrmMarketingRoiDeepController } from "./controllers/crm-marketing-roi-deep.controller";
import { CrmCustomerLifecycleDeepService } from "./services/crm-customer-lifecycle-deep.service";
import { CrmCustomerLifecycleDeepController } from "./controllers/crm-customer-lifecycle-deep.controller";
import { CrmSalesOperationsDeepService } from "./services/crm-sales-operations-deep.service";
import { CrmSalesOperationsDeepController } from "./controllers/crm-sales-operations-deep.controller";
import { CrmRevenueOptimizationDeepService } from "./services/crm-revenue-optimization-deep.service";
import { CrmRevenueOptimizationDeepController } from "./controllers/crm-revenue-optimization-deep.controller";
import { CrmCustomerExperienceDeepService } from "./services/crm-customer-experience-deep.service";
import { CrmCustomerExperienceDeepController } from "./controllers/crm-customer-experience-deep.controller";
import {
  CrmRelationshipsDeepController,
  CrmPipelineOpsController,
  CrmSalesForecastingDeepController,
  CrmSalesAnalyticsExpansionController,
} from "./controllers/crm-deep-expansion-v2.controller";

import { CrmRepository } from "./repositories/crm.repository";

const CRM_SERVICES = [
  CrmRepository,
  CrmService,
  CrmIntelligenceService,
  CrmIntegrationsService,
  CrmCustomersService,
  CrmContactsService,
  CrmLeadsService,
  CrmDealsService,
  CrmActivitiesService,
  CrmMarketingService,
  CrmSalesOpsService,
  CrmConfigService,
  CrmCollaborationService,
  CrmDashboardsService,
  CrmCasesService,
  CrmLeadScoringService,
  CrmDuplicatesService,
  CrmPipelineStagesService,
  CrmSegmentsService,
  CrmSlaService,
  CrmContractsService,
  CrmMailboxService,
  CrmMailboxProviderClientService,
  CrmForecastingService,
  CrmAccountManagementService,
  CrmCampaignManagementService,
  CrmSupportService,
  CrmEnablementService,
  CrmRevOpsService,
  CrmPartnersService,
  CrmAutomationService,
  CustomerPortalService,
  CrmTerritoryRulesService,
  CrmCadencesService,
  CrmQuoteSignatureService,
  CrmPipelineRiskService,
  CrmPortalPaymentGatewayService,
  CrmPortalDocumentsService,
  CrmRevenueIntelligenceService,
  CrmConversationIntelligenceService,
  CrmConversionAnalyticsService,
  CrmAiDraftingService,
  CrmGamificationService,
  CrmCommissionAutomationService,
  CrmCoachingService,
  CrmDealRoomService,
  CrmSalesAutomationService,
  CrmCustomerSuccessService,
  CrmMarketingAutomationService,
  CrmLeadEnrichmentService,
  CrmGuidedSellingService,
  CrmContractLifecycleService,
  CrmCommunicationService,
  CrmKnowledgeBaseService,
  CrmPartnerDeepService,
  CrmWinLossService,
  CrmCustomerJourneyService,
  AppSettingsService,
  CrmExpansionV1Service,
  CrmActivityCaptureService,
  CrmMarketingDeepService,
  CrmCpqService,
  CrmSupportDeepService,
  CrmPortalDeepService,
  CrmForecastGovernanceService,
  CrmDealDeskService,
  CrmContentManagementService,
  CrmDataManagementService,
  CrmTerritoryDeepService,
  CrmReportingDeepService,
  CrmPartnerDeepTwoService,
  CrmIntegrationDeepService,
  CrmPipelineDeepService,
  CrmAbmOrchestrationService,
  CrmChannelPortalDeepService,
  CrmAiIntelligenceService,
  CrmCompetitorIntelligenceService,
  CrmGamificationDeepService,
  CrmCoachingDeepService,
  CrmCommunicationDeepService,
  CrmContractDeepService,
  CrmCustomerSuccessDeepService,
  CrmAccountHierarchiesDeepService,
  CrmDealAnalyticsDeepService,
  CrmAccountIntelligenceDeepService,
  CrmMarketingRoiDeepService,
  CrmCustomerLifecycleDeepService,
  CrmSalesOperationsDeepService,
  CrmRevenueOptimizationDeepService,
  CrmCustomerExperienceDeepService,
];

@Module({
  imports: [CrmEnterpriseModule],
  controllers: [
    CrmController,
    CrmExpansionV1Controller,

    CrmDealDeskController,
    CrmIntelligenceController,
    CrmLeadScoringController,
    CrmDuplicatesController,
    CrmPipelineStagesController,
    CrmSegmentsController,
    CrmSlaController,
    CrmContractsController,
    CrmMailboxController,
    CrmExpansionController,
    CustomerPortalAdminController,
    CustomerPortalController,
    CrmTerritoryRulesController,
    CrmCadencesController,
    CrmQuoteSignatureController,
    CrmQuoteSignaturePublicController,
    CrmPipelineRiskController,
    CrmRevenueIntelligenceController,
    CrmConversationIntelligenceController,
    CrmConversionAnalyticsController,
    CrmAiDraftingController,
    CrmGamificationController,
    CrmCommissionAutomationController,
    CrmCoachingController,
    CrmDealRoomController,
    CrmDealRoomPublicController,

    CrmExpansionDeepController,
    CrmActivityCaptureController,
    CrmMarketingDeepController,
    CrmLeadEnrichmentSourceController,
    CrmLeadEnrichmentRuleController,
    CrmLeadEnrichmentFieldMappingController,
    CrmLeadEnrichmentExecutionController,
    CrmLeadEnrichmentScheduleController,
    CrmLeadEnrichmentAnalyticsController,
    CrmNextBestActionConfigController,
    CrmGuidedSellingSuggestionController,
    CrmGuidedSellingPlaybookController,
    CrmGuidedSellingDealReadinessController,
    CrmGuidedSellingAnalyticsController,
    CrmContractAmendmentController,
    CrmContractPriceEscalationController,
    CrmContractAutoRenewalController,
    CrmContractExpirationPipelineController,
    CrmContractTemplateController,
    CrmContractClauseController,
    CrmContractLifecycleAnalyticsController,
    CrmCommunicationChannelController,
    CrmCommunicationTemplateController,
    CrmCommunicationLogController,
    CrmKnowledgeBaseCategoryController,
    CrmKnowledgeBaseArticleController,
    CrmPartnerDealRegistrationController,
    CrmPartnerMdfController,
    CrmWinLossController,
    CrmCustomerJourneyController,
    CrmCpqController,
    CrmSupportDeepController,
    CrmPortalDeepController,
    CrmContentManagementController,
    CrmDataManagementController,
    CrmTerritoryDeepController,
    CrmReportingDeepController,
    CrmPartnerDeepTwoController,
    CrmIntegrationDeepController,
    CrmPipelineDeepController,
    CrmAbmOrchestrationController,
    CrmSettingsController,
    CrmAiIntelligenceController,
    CrmCompetitorIntelligenceController,
    CrmGamificationDeepController,
    CrmCoachingDeepController,
    CrmCommunicationDeepController,
    CrmContractDeepController,
    CrmCustomerSuccessDeepController,
    CrmAccountHierarchiesDeepController,
    CrmDealAnalyticsDeepController,
    CrmAccountIntelligenceDeepController,
    CrmMarketingRoiDeepController,
    CrmCustomerLifecycleDeepController,
    CrmSalesOperationsDeepController,
    CrmRevenueOptimizationDeepController,
    CrmCustomerExperienceDeepController,
    CrmRelationshipsDeepController,
    CrmPipelineOpsController,
    CrmSalesForecastingDeepController,
    CrmSalesAnalyticsExpansionController,
  ],
  providers: CRM_SERVICES,
  exports: CRM_SERVICES,
})
export class CrmModule {}
