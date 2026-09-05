import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import {
  createDashboardSchema,
  CreateDashboardRequest,
  updateDashboardSchema,
  UpdateDashboardRequest,
  createReportSchema,
  CreateReportRequest,
  executePivotQueryRequestSchema,
  ExecutePivotQueryRequest,
  executeVisualQueryRequestSchema,
  ExecuteVisualQueryRequest,
} from "@kannan19302/contracts";
import { ZodBody } from "../../../common/decorators/zod-body.decorator";
import { Request } from "express";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { AnalyticsService } from "../services/analytics.service";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";

interface AuthenticatedRequest extends Request {
  user: {
    tenantId: string;
    userId: string;
    email: string;
    roles: string[];
    orgId?: string;
  };
}

@ApiTags("analytics")
@ApiBearerAuth()
@Controller("analytics")
@UseGuards(JwtAuthGuard, RbacGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @ApiOperation({ summary: "Get dashboards" })
  @Get("dashboards")
  @Permissions("analytics.dashboard.read")
  async getDashboards(@Req() req: AuthenticatedRequest) {
    return this.analyticsService.getDashboards(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get dashboard by id" })
  @Get("dashboards/:id")
  @Permissions("analytics.dashboard.read")
  async getDashboardById(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.analyticsService.getDashboardById(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Create dashboard" })
  @Post("dashboards")
  @Permissions("analytics.dashboard.create")
  async createDashboard(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createDashboardSchema)
    dto: CreateDashboardRequest,
  ) {
    const orgId = req.user.orgId || "org-system-default";
    return this.analyticsService.createDashboard(req.user.tenantId, orgId, dto);
  }

  @ApiOperation({ summary: "Get reports" })
  @Get("reports")
  @Permissions("analytics.report.read")
  async getReports(@Req() req: AuthenticatedRequest) {
    return this.analyticsService.getReports(req.user.tenantId);
  }

  @ApiOperation({ summary: "Create report" })
  @Post("reports")
  @Permissions("analytics.report.create")
  async createReport(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createReportSchema)
    dto: CreateReportRequest,
  ) {
    const orgId = req.user.orgId || "org-system-default";
    return this.analyticsService.createReport(req.user.tenantId, orgId, dto);
  }

  @ApiOperation({ summary: "Get k p is" })
  @Get("kpis")
  @Permissions("analytics.kpi.read")
  async getKPIs(@Req() req: AuthenticatedRequest) {
    return this.analyticsService.getKPIs(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get kpi drilldown" })
  @Get("kpis/:code/drilldown")
  @Permissions("analytics.kpi.read")
  async getKpiDrilldown(
    @Req() req: AuthenticatedRequest,
    @Param("code") code: string,
  ) {
    return this.analyticsService.getKpiDrilldown(req.user.tenantId, code);
  }

  @ApiOperation({ summary: "Get insights" })
  @Get("insights")
  @Permissions("analytics.report.read")
  async getInsights(@Req() req: AuthenticatedRequest) {
    return this.analyticsService.getInsights(req.user.tenantId);
  }

  @ApiOperation({ summary: "Export dataset" })
  @Get("export/:dataset")
  @Permissions("analytics.report.read")
  async exportDataset(
    @Req() req: AuthenticatedRequest,
    @Param("dataset") dataset: string,
  ) {
    return this.analyticsService.exportDataset(req.user.tenantId, dataset);
  }

  @ApiOperation({ summary: "Get historical monthly revenue" })
  @Get("monthly-revenue")
  @Permissions("analytics.kpi.read")
  async getHistoricalMonthlyRevenue(@Req() req: AuthenticatedRequest) {
    return this.analyticsService.getHistoricalMonthlyRevenue(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get recent audit & entity activity telemetry" })
  @Get("activity")
  @Permissions("analytics.kpi.read")
  async getRecentActivity(@Req() req: AuthenticatedRequest) {
    return this.analyticsService.getRecentActivity(req.user.tenantId);
  }

  @ApiOperation({ summary: "Update dashboard" })
  @Patch("dashboards/:id")
  @Permissions("analytics.dashboard.create")
  async updateDashboard(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @ZodBody(updateDashboardSchema)
    dto: UpdateDashboardRequest,
  ) {
    return this.analyticsService.updateDashboard(req.user.tenantId, id, dto);
  }

  @ApiOperation({ summary: "Execute pivot query" })
  @Post("reports/:id/pivot")
  @Permissions("analytics.report.read")
  async executePivotQuery(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @ZodBody(executePivotQueryRequestSchema)
    dto: ExecutePivotQueryRequest,
  ) {
    return this.analyticsService.executePivotQuery(req.user.tenantId, id, dto);
  }

  @ApiOperation({ summary: "Run secure visual query" })
  @Post("query/visual")
  @Permissions("analytics.report.read")
  async runSecureVisualQuery(
    @Req() req: AuthenticatedRequest,
    @ZodBody(executeVisualQueryRequestSchema)
    dto: ExecuteVisualQueryRequest,
  ) {
    return this.analyticsService.runSecureVisualQuery(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: "Delete dashboard" })
  @Delete("dashboards/:id")
  @Permissions("analytics.dashboard.create")
  async deleteDashboard(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.analyticsService.deleteDashboard(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Delete report" })
  @Delete("reports/:id")
  @Permissions("analytics.report.create")
  async deleteReport(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.analyticsService.deleteReport(req.user.tenantId, id);
  }
}

