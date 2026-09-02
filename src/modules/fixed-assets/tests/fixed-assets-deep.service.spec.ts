import { describe, it, expect, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { AssetInsuranceService } from "../services/asset-insurance.service";
import { AssetRevaluationService } from "../services/asset-revaluation.service";
import { AssetPhysicalAuditService } from "../services/asset-physical-audit.service";
import { AssetWarrantyService } from "../services/asset-warranty.service";
import { AssetComponentService } from "../services/asset-component.service";
import { AssetImpairmentService } from "../services/asset-impairment.service";
import { AssetConditionService } from "../services/asset-condition.service";
import { AssetUtilizationService } from "../services/asset-utilization.service";
import { AssetGroupService } from "../services/asset-group.service";
import { AssetBudgetService } from "../services/asset-budget.service";
import { AssetDocumentService } from "../services/asset-document.service";

describe("FixedAssetsDeepServices", () => {
  let warrantyService: AssetWarrantyService;
  let componentService: AssetComponentService;
  let impairmentService: AssetImpairmentService;
  let conditionService: AssetConditionService;
  let utilizationService: AssetUtilizationService;
  let groupService: AssetGroupService;
  let budgetService: AssetBudgetService;
  let documentService: AssetDocumentService;
  let insuranceService: AssetInsuranceService;
  let revaluationService: AssetRevaluationService;
  let auditService: AssetPhysicalAuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetInsuranceService,
        AssetRevaluationService,
        AssetPhysicalAuditService,
        AssetWarrantyService,
        AssetComponentService,
        AssetImpairmentService,
        AssetConditionService,
        AssetUtilizationService,
        AssetGroupService,
        AssetBudgetService,
        AssetDocumentService,
      ],
    }).compile();
    warrantyService = module.get(AssetWarrantyService);
    componentService = module.get(AssetComponentService);
    impairmentService = module.get(AssetImpairmentService);
    conditionService = module.get(AssetConditionService);
    utilizationService = module.get(AssetUtilizationService);
    groupService = module.get(AssetGroupService);
    budgetService = module.get(AssetBudgetService);
    documentService = module.get(AssetDocumentService);
    insuranceService = module.get(AssetInsuranceService);
    revaluationService = module.get(AssetRevaluationService);
    auditService = module.get(AssetPhysicalAuditService);
  });

  it("should be defined", () => {
    expect(warrantyService).toBeDefined();
    expect(componentService).toBeDefined();
    expect(impairmentService).toBeDefined();
    expect(conditionService).toBeDefined();
    expect(utilizationService).toBeDefined();
    expect(groupService).toBeDefined();
    expect(budgetService).toBeDefined();
    expect(documentService).toBeDefined();
    expect(insuranceService).toBeDefined();
    expect(revaluationService).toBeDefined();
    expect(auditService).toBeDefined();
  });
});
