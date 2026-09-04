import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface ReportDefinitionFilters extends PaginationParams {
  category?: string;
  isPublic?: boolean;
}

/**
 * Authoritative Domain Repository for Analytics Dashboards, Reports, KPIs,
 * and Cross-Domain Aggregations.
 */
@Injectable()
export class AnalyticsRepository {
  // ── Dashboards ──────────────────────────────────────────────────────────
  async findDashboards(tenantId: string) {
    return prisma.dashboard.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findDashboardById(tenantId: string, id: string) {
    return prisma.dashboard.findFirst({
      where: { id, tenantId },
    });
  }

  async createDashboard(data: {
    tenantId: string;
    orgId: string;
    name: string;
    description?: string | null;
    layout: any;
  }) {
    return prisma.dashboard.create({
      data: {
        tenantId: data.tenantId,
        orgId: data.orgId,
        name: data.name,
        description: data.description || null,
        layout: data.layout || [],
      },
    });
  }

  async updateDashboard(
    tenantId: string,
    id: string,
    data: { name?: string; description?: string | null; layout?: any },
  ) {
    return prisma.dashboard.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.layout !== undefined ? { layout: data.layout as never } : {}),
      },
    });
  }

  async deleteDashboard(tenantId: string, id: string) {
    return prisma.dashboard.deleteMany({
      where: { id, tenantId },
    });
  }

  // ── Reports ─────────────────────────────────────────────────────────────
  async findReports(
    tenantId: string,
    params: ReportDefinitionFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.category) where.category = params.category;
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [reports, total] = await Promise.all([
      prisma.reportDefinition.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.reportDefinition.count({ where }),
    ]);

    return paginatedResult(reports, total, params);
  }

  async findReportById(tenantId: string, id: string): Promise<any | null> {
    return prisma.reportDefinition.findFirst({
      where: { id, tenantId },
    });
  }

  async findSimpleReports(tenantId: string) {
    return prisma.report.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
  }

  async findSimpleReportById(tenantId: string, id: string) {
    return prisma.report.findFirst({
      where: { id, tenantId },
    });
  }

  async createSimpleReport(data: {
    tenantId: string;
    orgId: string;
    name: string;
    description?: string | null;
    query: any;
    type: string;
  }) {
    return prisma.report.create({
      data: {
        tenantId: data.tenantId,
        orgId: data.orgId,
        name: data.name,
        description: data.description || null,
        query: data.query || {},
        type: data.type || "BUILDER",
      },
    });
  }

  async deleteReport(tenantId: string, id: string) {
    return prisma.report.deleteMany({
      where: { id, tenantId },
    });
  }

  // ── KPIs ────────────────────────────────────────────────────────────────
  async findKpis(tenantId: string) {
    return prisma.kPI.findMany({
      where: { tenantId },
    });
  }

  async createKpis(
    items: Array<{
      tenantId: string;
      orgId: string;
      name: string;
      code: string;
      value: string;
      unit?: string | null;
      trend: string;
    }>,
  ) {
    return prisma.kPI.createMany({
      data: items,
    });
  }

  // ── Organization ────────────────────────────────────────────────────────
  async findFirstOrganization(tenantId: string) {
    return prisma.organization.findFirst({
      where: { tenantId },
    });
  }

  // ── Cross-Domain Telemetry & Aggregation Data Access ─────────────────────
  async getInvoiceSummary(tenantId: string) {
    const aggregate = await prisma.invoice.aggregate({
      where: { tenantId },
      _sum: { totalAmount: true },
      _count: { id: true },
    });
    return {
      totalAmount: Number(aggregate._sum.totalAmount || 0),
      count: aggregate._count.id,
    };
  }

  async countEmployees(tenantId: string) {
    return prisma.employee.count({
      where: { tenantId },
    });
  }

  async countProducts(tenantId: string) {
    return prisma.product.count({
      where: { tenantId },
    });
  }

  async findInvoicesForDrilldown(tenantId: string, take = 50) {
    return prisma.invoice.findMany({
      where: { tenantId },
      select: {
        invoiceNumber: true,
        totalAmount: true,
        status: true,
        issueDate: true,
      },
      orderBy: { issueDate: "desc" },
      take,
    });
  }

  async findEmployeesForDrilldown(tenantId: string, take = 100) {
    return prisma.employee.findMany({
      where: { tenantId },
      select: {
        employeeCode: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
      },
      take,
    });
  }

  async findProductsForDrilldown(tenantId: string, take = 100) {
    return prisma.product.findMany({
      where: { tenantId },
      select: {
        sku: true,
        name: true,
        category: true,
        sellPrice: true,
        isActive: true,
      },
      take,
    });
  }

  async findInvoicesForInsights(tenantId: string) {
    return prisma.invoice.findMany({
      where: { tenantId },
      select: {
        totalAmount: true,
        issueDate: true,
        status: true,
        dueDate: true,
        paidAmount: true,
        invoiceNumber: true,
      },
    });
  }

  async findLowMarginProducts(tenantId: string, take = 20) {
    return prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: {
        sku: true,
        name: true,
        costPrice: true,
        sellPrice: true,
      },
      take,
    });
  }

  async findInvoicesForExport(tenantId: string) {
    return prisma.invoice.findMany({
      where: { tenantId },
      select: {
        invoiceNumber: true,
        totalAmount: true,
        paidAmount: true,
        status: true,
        issueDate: true,
        dueDate: true,
      },
    });
  }

  async findProductsForExport(tenantId: string) {
    return prisma.product.findMany({
      where: { tenantId },
      select: {
        sku: true,
        name: true,
        category: true,
        costPrice: true,
        sellPrice: true,
        isActive: true,
      },
    });
  }

  async findEmployeesForExport(tenantId: string) {
    return prisma.employee.findMany({
      where: { tenantId },
      select: {
        employeeCode: true,
        firstName: true,
        lastName: true,
        email: true,
        designation: true,
        status: true,
      },
    });
  }

  async executeVisualQueryScan(
    tenantId: string,
    selectFields: string[],
    take = 20,
  ) {
    return prisma.invoice.findMany({
      where: { tenantId },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        status: true,
        createdAt: true,
      },
      take,
    });
  }

  async getRecentActivityTelemetry(tenantId: string) {
    const [recentInvoices, activeEmployees, recentAuditLogs] = await Promise.all([
      prisma.invoice.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.employee.count({
        where: { tenantId, status: "ACTIVE" },
      }),
      prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          action: true,
          entityType: true,
          createdAt: true,
        },
      }).catch(() => []),
    ]);

    return {
      recentInvoices,
      activeEmployees,
      recentAuditLogs,
    };
  }

  // ── Predictive Models & Forecast Runs ────────────────────────────────────
  async findPredictiveModels(tenantId: string) {
    return prisma.analyticsPredictiveModel.findMany({
      where: { tenantId },
      orderBy: { trainedAt: "desc" },
    });
  }

  async createPredictiveModel(data: {
    tenantId: string;
    modelName: string;
    algorithm: string;
    targetMetric: string;
    accuracyScore: number;
    status: string;
  }) {
    return prisma.analyticsPredictiveModel.create({
      data,
    });
  }

  async createForecastRun(data: {
    modelId: string;
    tenantId: string;
    forecastHorizon: string;
    resultMetrics: any;
  }) {
    return prisma.analyticsForecastRun.create({
      data,
    });
  }

  async getHistoricalMonthlyRevenue(tenantId: string) {
    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      select: {
        totalAmount: true,
        issueDate: true,
      },
      orderBy: { issueDate: "asc" },
    });

    const monthlyMap = new Map<string, number>();
    for (const inv of invoices) {
      const monthKey = inv.issueDate.toISOString().slice(0, 7);
      monthlyMap.set(
        monthKey,
        (monthlyMap.get(monthKey) || 0) + Number(inv.totalAmount || 0),
      );
    }

    return Array.from(monthlyMap.entries()).map(([month, amount]) => ({
      month,
      amount,
    }));
  }

  // ── Real-time Pivot Matrix Aggregations ─────────────────────────────────
  async executePivotAggregation(
    tenantId: string,
    rowField: string = "Quarter",
    colField: string = "Status",
    aggregation: string = "SUM(totalAmount)",
  ) {
    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      select: {
        id: true,
        totalAmount: true,
        status: true,
        issueDate: true,
      },
    });

    if (invoices.length === 0) {
      return [];
    }

    const getRowKey = (inv: (typeof invoices)[0]) => {
      if (rowField.toLowerCase().includes("quarter")) {
        const d = inv.issueDate;
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `${d.getFullYear()}-Q${q}`;
      }
      if (rowField.toLowerCase().includes("status")) {
        return inv.status || "UNKNOWN";
      }
      return inv.issueDate.toISOString().slice(0, 7);
    };

    const getColKey = (inv: (typeof invoices)[0]) => {
      if (colField.toLowerCase().includes("status")) {
        return inv.status || "DEFAULT";
      }
      if (colField.toLowerCase().includes("quarter")) {
        const d = inv.issueDate;
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `Q${q}`;
      }
      return "General";
    };

    const matrix = new Map<string, { sum: number; count: number }>();

    for (const inv of invoices) {
      const r = getRowKey(inv);
      const c = getColKey(inv);
      const key = `${r}:::${c}`;
      const curr = matrix.get(key) || { sum: 0, count: 0 };
      curr.sum += Number(inv.totalAmount || 0);
      curr.count += 1;
      matrix.set(key, curr);
    }

    const isAvg = aggregation.toLowerCase().includes("avg");
    const isCount = aggregation.toLowerCase().includes("count");

    return Array.from(matrix.entries()).map(([key, stats]) => {
      const [row, column] = key.split(":::");
      let value = stats.sum;
      if (isAvg) {
        value = stats.count > 0 ? stats.sum / stats.count : 0;
      } else if (isCount) {
        value = stats.count;
      }
      return {
        row: row || "N/A",
        column: column || "N/A",
        value: Math.round(value * 100) / 100,
        count: stats.count,
      };
    });
  }
}

