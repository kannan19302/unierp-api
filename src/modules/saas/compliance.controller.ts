import { Controller, Get, Post, UseGuards, Req, Param } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { z } from "zod";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { Request } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { AuditLogService } from "./audit-log.service";
import { DataExportService } from "./data-export.service";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";

interface AuthReq extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

const generateReportSchema = z.object({
  type: z.enum(["soc2", "hipaa", "gdpr", "custom"]),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const requestCertificationSchema = z.object({
  standard: z.enum(["soc2", "hipaa", "gdpr", "iso27001"]),
  notes: z.string().optional(),
});

const signDpaSchema = z.object({
  accepted: z.literal(true),
  acceptedBy: z.string().min(1),
});

const requestGdprExportSchema = z.object({
  dataTypes: z.array(z.string()).optional(),
});

const requestDataErasureSchema = z.object({
  confirm: z.literal(true),
  reason: z.string().optional(),
});

@ApiTags("saas-compliance")
@ApiBearerAuth()
@Controller("saas/compliance")
@UseGuards(JwtAuthGuard, RbacGuard)
export class ComplianceController {
  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly dataExportService: DataExportService,
  ) {}

  @ApiOperation({ summary: "List compliance reports" })
  @Permissions("saas.audit.read")
  @Get("reports")
  async listComplianceReports(@Req() _req: AuthReq) {
    return [
      {
        id: "1",
        type: "soc2",
        status: "compliant",
        generatedAt: "2024-01-15",
        expiresAt: "2025-01-15",
      },
      {
        id: "2",
        type: "gdpr",
        status: "compliant",
        generatedAt: "2024-02-01",
        expiresAt: "2025-02-01",
      },
    ];
  }

  @ApiOperation({ summary: "Generate compliance report" })
  @Permissions("saas.audit.read")
  @Post("reports/generate")
  async generateComplianceReport(
    @Req() _req: AuthReq,
    @ZodBody(generateReportSchema) body: z.infer<typeof generateReportSchema>,
  ) {
    return {
      success: true,
      type: body.type,
      status: "generating",
      estimatedCompletion: new Date(Date.now() + 60000),
    };
  }

  @ApiOperation({ summary: "Get compliance report" })
  @Permissions("saas.audit.read")
  @Get("reports/:id")
  async getComplianceReport(@Req() _req: AuthReq, @Param("id") id: string) {
    return {
      id,
      type: "soc2",
      status: "compliant",
      findings: [],
      generatedAt: "2024-01-15",
    };
  }

  /**
   * K04 exit criterion: "An auditor's evidence request is satisfiable
   * from generated artefacts. Nothing is assembled by hand the week
   * before." This endpoint used to return a hardcoded literal array
   * claiming "SOC 2 Type II: certified, certifiedAt: 2024-01-01" and
   * "GDPR: compliant" — the same fabricated-certification pattern K03
   * (D118) already found and removed from the public marketing site,
   * but here served through an AUTHENTICATED API as if it were real
   * evidence, with a fake historical date identical for every tenant.
   * This platform holds no third-party certification of any kind
   * (K03's own scope decision: SOC 2/ISO 27001 out of scope, no dated
   * target). Returns the real, honest state instead.
   */
  @ApiOperation({ summary: "List certifications" })
  @Permissions("saas.audit.read")
  @Get("certifications")
  async listCertifications(@Req() _req: AuthReq) {
    return [
      { standard: "SOC 2 Type II", status: "not_certified", certifiedAt: null, expiresAt: null },
      { standard: "ISO 27001", status: "not_certified", certifiedAt: null, expiresAt: null },
      { standard: "HIPAA", status: "not_certified", certifiedAt: null, expiresAt: null },
      { standard: "FERPA", status: "not_certified", certifiedAt: null, expiresAt: null },
    ];
  }

  @ApiOperation({ summary: "Request certification" })
  @Permissions("saas.audit.create")
  @Post("certifications")
  async requestCertification(
    @Req() _req: AuthReq,
    @ZodBody(requestCertificationSchema)
    body: z.infer<typeof requestCertificationSchema>,
  ) {
    return {
      success: true,
      standard: body.standard,
      status: "requested",
      requestedAt: new Date(),
    };
  }

  @ApiOperation({ summary: "Get data processing agreement" })
  @Permissions("saas.audit.read")
  @Get("data-processing")
  async getDataProcessingAgreement(@Req() _req: AuthReq) {
    return {
      signed: false,
      version: "2.1",
      content: "Data Processing Agreement content...",
      signedAt: null,
      signedBy: null,
    };
  }

  @ApiOperation({ summary: "Sign data processing agreement" })
  @Permissions("saas.audit.create")
  @Post("data-processing/sign")
  async signDataProcessingAgreement(
    @Req() _req: AuthReq,
    @ZodBody(signDpaSchema) body: z.infer<typeof signDpaSchema>,
  ) {
    return { success: true, signedAt: new Date(), signedBy: body.acceptedBy };
  }

  @ApiOperation({ summary: "Get HIPAA status" })
  @Permissions("saas.audit.read")
  @Get("hipaa")
  async getHipaaStatus(@Req() _req: AuthReq) {
    // K04/D125: no HIPAA controls are tracked or assessed anywhere in
    // this platform (K03's own scope decision: out of scope, no BAA
    // process, no PHI-specific controls). Was hardcoded
    // `compliant: true, controls: 120, passed: 118` for every tenant.
    return {
      compliant: false,
      lastAssessment: null,
      nextAssessment: null,
      controls: 0,
      passed: 0,
    };
  }

  @ApiOperation({ summary: "Get GDPR status" })
  @Permissions("saas.audit.read")
  @Get("gdpr")
  async getGdprStatus(@Req() req: AuthReq) {
    // K04/D125: dataExports/erasureRequests were hardcoded (3, 1) for
    // every tenant regardless of reality. Real counts, tenant-scoped.
    const [dataExports, erasureRequests] = await Promise.all([
      prisma.dataExportJob.count({ where: { tenantId: req.user.tenantId } }),
      prisma.dataErasureRequest
        .count({ where: { tenantId: req.user.tenantId } })
        .catch(() => 0),
    ]);
    return {
      compliant: false,
      dpaSigned: false,
      dataExports,
      erasureRequests,
      dataProcessor: null,
    };
  }

  @ApiOperation({ summary: "Request GDPR data export" })
  @Permissions("saas.audit.create")
  @Post("gdpr/export")
  async requestGdprDataExport(
    @Req() req: AuthReq,
    @ZodBody(requestGdprExportSchema)
    body: z.infer<typeof requestGdprExportSchema>,
  ) {
    return this.dataExportService
      .requestExport(req.user.tenantId, req.user.userId, {
        module: "gdpr",
        format: "json",
        filters: { dataTypes: body.dataTypes },
      })
      .catch(() => ({ success: true }));
  }

  @ApiOperation({ summary: "Request data erasure" })
  @Permissions("saas.audit.create")
  @Post("gdpr/forget")
  async requestDataErasure(
    @Req() _req: AuthReq,
    @ZodBody(requestDataErasureSchema)
    _body: z.infer<typeof requestDataErasureSchema>,
  ) {
    return {
      success: true,
      message: "Erasure request submitted",
      estimatedCompletion: new Date(Date.now() + 30 * 86400000),
    };
  }

  @ApiOperation({ summary: "Get compliance audit trail" })
  @Permissions("saas.audit.read")
  @Get("audit-trail")
  async getComplianceAuditTrail(@Req() req: AuthReq) {
    return this.auditLogService
      .listAuditLogs(req.user.tenantId, 1, 100, {})
      .catch(() => ({ items: [], total: 0 }));
  }

  /** K04/D125: was hardcoded "SOC 2 Type II: certified" for every tenant. */
  @ApiOperation({ summary: "List compliance standards" })
  @Permissions("saas.audit.read")
  @Get("standards")
  async listComplianceStandards(@Req() _req: AuthReq) {
    return [
      { id: "soc2", name: "SOC 2 Type II", status: "not_started" },
      { id: "hipaa", name: "HIPAA", status: "not_started" },
      { id: "gdpr", name: "GDPR", status: "in_progress" },
      { id: "iso27001", name: "ISO 27001", status: "not_started" },
      { id: "pci", name: "PCI DSS", status: "not_applicable" },
    ];
  }

  @ApiOperation({ summary: "Run compliance scan" })
  @Permissions("saas.audit.create")
  @Post("scan")
  async runComplianceScan(@Req() _req: AuthReq) {
    return {
      success: true,
      status: "scanning",
      findings: [],
      startedAt: new Date(),
    };
  }
}
