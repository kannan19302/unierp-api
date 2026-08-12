import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ReportingEngineService } from "./reporting-engine.service";

@Injectable()
export class ReportingService {
  constructor(private readonly reportingEngine: ReportingEngineService) {}

  /**
   * E35 exit criterion: "A tenant user builds a cross-module report
   * without SQL, and it respects their permissions, not the author's."
   * `Report.query` (type: "BUILDER") stores a semantic-layer query
   * built via the report builder — but this is the report's own
   * saved definition, built once by its author. A saved/shared report
   * must be re-authorized against whoever is VIEWING it each time it
   * runs, not rubber-stamped because the author was once allowed to
   * build it. Reuses the same requiredPermission gate on the semantic
   * layer that AiCopilotService.askData() enforces (E46/D105) — one
   * governed permission check, not two different ones drifting apart.
   */
  async runReport(
    tenantId: string,
    id: string,
    viewerPermissions: string[] = [],
  ) {
    const report = await prisma.report.findFirst({ where: { id, tenantId } });
    if (!report) throw new NotFoundException("Report not found");

    const query = (report.query as Record<string, unknown>) || {};
    const entityName = query.entity as string | undefined;
    const semanticLayer = this.reportingEngine.getSemanticLayer();
    const matchedEntity = semanticLayer.find((e) => e.name === entityName);

    if (
      matchedEntity?.requiredPermission &&
      !viewerPermissions.includes(matchedEntity.requiredPermission)
    ) {
      throw new ForbiddenException(
        `You do not have permission to view this report's "${matchedEntity.label}" data.`,
      );
    }

    if (!entityName || !matchedEntity) {
      return { report, data: [] };
    }

    const result = await this.reportingEngine.executeQuery(
      tenantId,
      entityName,
      query as any,
    );
    return { report, data: result.data ?? [] };
  }

  async getReports(tenantId: string) {
    return prisma.report.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createReport(tenantId: string, body: any) {
    return prisma.report.create({ data: { ...body, tenantId } as any });
  }

  async getReportCategories(tenantId: string) {
    return prisma.reportCategory.findMany({ where: { tenantId } });
  }

  async cloneReport(tenantId: string, id: string) {
    const original = await prisma.report.findFirst({ where: { id, tenantId } });
    if (!original) throw new NotFoundException("Report not found");
    return prisma.report.create({
      data: {
        ...original,
        id: undefined,
        name: `${original.name} (Copy)`,
        tenantId,
      } as any,
    });
  }

  async getReportingStats(tenantId: string) {
    const [reports, templates, jobs, exports] = await Promise.all([
      prisma.report.count({ where: { tenantId } }),
      prisma.reportingTemplateDeep.count({ where: { tenantId } }),
      prisma.reportingScheduledJobDeep.count({ where: { tenantId } }),
      prisma.reportingExportJob.count({ where: { tenantId } }),
    ]);
    return { reports, templates, jobs, exports };
  }

  async deleteReport(tenantId: string, id: string) {
    const existing = await prisma.report.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException("Report not found");
    return prisma.report.delete({ where: { id } });
  }

  async getWidgets(tenantId: string) {
    return prisma.reportWidget.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createWidget(
    tenantId: string,
    dto: {
      dashboardId: string;
      title: string;
      chartType: string;
      queryConfig: string;
      position: string;
    },
  ) {
    return prisma.reportWidget.create({
      data: {
        tenantId,
        dashboardId: dto.dashboardId,
        title: dto.title,
        chartType: dto.chartType,
        queryConfig: dto.queryConfig,
        position: dto.position,
      },
    });
  }

  async getViews(tenantId: string) {
    return prisma.reportView.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createView(
    tenantId: string,
    dto: {
      name: string;
      queryConfig: string;
      isScheduled?: boolean;
      scheduleCron?: string;
      recipientEmails?: string;
    },
  ) {
    return prisma.reportView.create({
      data: {
        tenantId,
        name: dto.name,
        queryConfig: dto.queryConfig,
        isScheduled: dto.isScheduled ?? false,
        scheduleCron: dto.scheduleCron,
        recipientEmails: dto.recipientEmails,
      },
    });
  }
}
