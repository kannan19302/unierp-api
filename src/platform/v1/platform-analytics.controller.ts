import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import {
  PlatformAnalyticsService,
  DashboardWidget,
} from "./platform-analytics.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/analytics")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class PlatformAnalyticsController {
  constructor(private readonly analyticsService: PlatformAnalyticsService) {}

  // ── Dashboard Composer (EC-16.1) ──

  @ApiOperation({ summary: "List all composed platform analytics dashboards" })
  @Get("dashboards")
  @Permissions("system.analytics.read")
  async listDashboards() {
    return this.analyticsService.listDashboards();
  }

  @ApiOperation({ summary: "Get a specific dashboard layout by ID" })
  @Get("dashboards/:id")
  @Permissions("system.analytics.read")
  async getDashboard(@Param("id") id: string) {
    return this.analyticsService.getDashboard(id);
  }

  @ApiOperation({ summary: "Create a custom dashboard layout with widgets" })
  @Post("dashboards")
  @Permissions("system.analytics.manage")
  async createDashboard(
    @Body()
    body: {
      name: string;
      description?: string;
      category?: "REVENUE" | "OPERATIONS" | "SECURITY" | "USAGE";
      widgets: DashboardWidget[];
    }
  ) {
    return this.analyticsService.createDashboard(body);
  }

  @ApiOperation({ summary: "Update a custom dashboard layout and widget definitions" })
  @Put("dashboards/:id")
  @Permissions("system.analytics.manage")
  async updateDashboard(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      category?: "REVENUE" | "OPERATIONS" | "SECURITY" | "USAGE";
      widgets?: DashboardWidget[];
    }
  ) {
    return this.analyticsService.updateDashboard(id, body);
  }

  @ApiOperation({ summary: "Delete a custom dashboard" })
  @Delete("dashboards/:id")
  @Permissions("system.analytics.manage")
  async deleteDashboard(@Param("id") id: string) {
    return this.analyticsService.deleteDashboard(id);
  }

  // ── Report Scheduler (EC-16.2) ──

  @ApiOperation({ summary: "List all recurring report schedules" })
  @Get("report-schedules")
  @Permissions("system.analytics.read")
  async listReportSchedules() {
    return this.analyticsService.listReportSchedules();
  }

  @ApiOperation({ summary: "Create a new recurring report schedule" })
  @Post("report-schedules")
  @Permissions("system.analytics.manage")
  async createReportSchedule(
    @Body()
    body: {
      name: string;
      dashboardId?: string;
      frequency: "DAILY" | "WEEKLY" | "MONTHLY";
      format: "PDF" | "CSV" | "EXCEL";
      recipients: string[];
    }
  ) {
    return this.analyticsService.createReportSchedule(body);
  }

  @ApiOperation({ summary: "Toggle active or paused state for a report schedule" })
  @Post("report-schedules/:id/toggle")
  @Permissions("system.analytics.manage")
  async toggleReportSchedule(@Param("id") id: string) {
    return this.analyticsService.toggleReportSchedule(id);
  }

  @ApiOperation({ summary: "Trigger immediate execution of a report schedule" })
  @Post("report-schedules/:id/run-now")
  @Permissions("system.analytics.manage")
  async triggerReportRun(@Param("id") id: string) {
    return this.analyticsService.triggerReportRun(id);
  }

  // ── Metrics & Anomaly Alerts ──

  @ApiOperation({ summary: "Get platform intelligence metrics catalogue and anomaly alerts" })
  @Get("metrics")
  @Permissions("system.analytics.read")
  async getMetrics() {
    return this.analyticsService.getPlatformMetrics();
  }
}
