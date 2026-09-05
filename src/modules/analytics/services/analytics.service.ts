import { Injectable, BadRequestException } from "@nestjs/common";
import type {
  CreateDashboardRequest,
  UpdateDashboardRequest,
  CreateReportRequest,
  ExecutePivotQueryRequest,
  ExecuteVisualQueryRequest,
} from "@kannan19302/contracts";
import { AnalyticsRepository } from "../repositories/analytics.repository";

@Injectable()
export class AnalyticsService {
  constructor(private readonly analyticsRepo: AnalyticsRepository) {}

  async getDashboards(tenantId: string) {
    return this.analyticsRepo.findDashboards(tenantId);
  }

  async getDashboardById(tenantId: string, id: string) {
    return this.analyticsRepo.findDashboardById(tenantId, id);
  }

  async createDashboard(
    tenantId: string,
    orgId: string,
    dto: CreateDashboardRequest,
  ) {
    let resolvedOrgId = orgId;
    if (!orgId || orgId === "org-system-default") {
      const org = await this.analyticsRepo.findFirstOrganization(tenantId);
      if (!org) throw new BadRequestException("No Organization found.");
      resolvedOrgId = org.id;
    }

    return this.analyticsRepo.createDashboard({
      tenantId,
      orgId: resolvedOrgId,
      name: dto.name,
      description: dto.description || null,
      layout: dto.layout || [],
    });
  }

  async getReports(tenantId: string) {
    return this.analyticsRepo.findSimpleReports(tenantId);
  }

  async createReport(
    tenantId: string,
    orgId: string,
    dto: CreateReportRequest,
  ) {
    let resolvedOrgId = orgId;
    if (!orgId || orgId === "org-system-default") {
      const org = await this.analyticsRepo.findFirstOrganization(tenantId);
      if (!org) throw new BadRequestException("No Organization found.");
      resolvedOrgId = org.id;
    }

    return this.analyticsRepo.createSimpleReport({
      tenantId,
      orgId: resolvedOrgId,
      name: dto.name,
      description: dto.description || null,
      query: dto.query || {},
      type: dto.type || "BUILDER",
    });
  }

  async getHistoricalMonthlyRevenue(tenantId: string) {
    return this.analyticsRepo.getHistoricalMonthlyRevenue(tenantId);
  }

  async getRecentActivity(tenantId: string) {
    return this.analyticsRepo.getRecentActivityTelemetry(tenantId);
  }

  async getKPIs(tenantId: string) {
    const existing = await this.analyticsRepo.findKpis(tenantId);

    if (existing.length === 0) {
      const invoiceSummary = await this.analyticsRepo.getInvoiceSummary(tenantId);
      const employeeCount = await this.analyticsRepo.countEmployees(tenantId);
      const productCount = await this.analyticsRepo.countProducts(tenantId);

      const org = await this.analyticsRepo.findFirstOrganization(tenantId);
      const orgId = org ? org.id : "org-default";

      await this.analyticsRepo.createKpis([
        {
          tenantId,
          orgId,
          name: "Total Revenue",
          code: "TOTAL_REVENUE",
          value: `$${invoiceSummary.totalAmount.toLocaleString()}`,
          unit: "USD",
          trend: JSON.stringify(invoiceSummary.totalAmount > 0 ? [invoiceSummary.totalAmount] : []),
        },
        {
          tenantId,
          orgId,
          name: "Total Employees",
          code: "TOTAL_EMPLOYEES",
          value: employeeCount.toString(),
          trend: JSON.stringify(employeeCount > 0 ? [employeeCount] : []),
        },
        {
          tenantId,
          orgId,
          name: "Total Products",
          code: "TOTAL_PRODUCTS",
          value: productCount.toString(),
          trend: JSON.stringify(productCount > 0 ? [productCount] : []),
        },
      ]);

      const seeded = await this.analyticsRepo.findKpis(tenantId);
      return seeded.map((k) => this.enrichKpi(k));
    }


    return existing.map((k) => this.enrichKpi(k));
  }

  private parseNumeric(value: string): number {
    if (value == null) return 0;
    const cleaned = String(value).replace(/[^0-9.-]/g, "");
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  private enrichKpi(k: {
    value: string;
    unit?: string | null;
    trend: unknown;
  }) {
    const trend: number[] =
      typeof k.trend === "string"
        ? JSON.parse(k.trend)
        : (k.trend as number[]) || [];
    const numericValue = this.parseNumeric(k.value);
    const target = Math.round(numericValue * 1.2) || 100;
    const progressPct =
      target > 0 ? Math.min(Math.round((numericValue / target) * 100), 100) : 0;

    let changePct = 0;
    if (Array.isArray(trend) && trend.length >= 2) {
      const last = trend[trend.length - 1] ?? 0;
      const prev = trend[trend.length - 2] ?? 0;
      changePct =
        prev !== 0 ? Math.round(((last - prev) / prev) * 1000) / 10 : 0;
    }

    return {
      ...k,
      trend,
      numericValue,
      target,
      targetValue:
        k.unit === "USD"
          ? `$${target.toLocaleString()}`
          : target.toLocaleString(),
      progressPct,
      changePct,
    };
  }

  async getKpiDrilldown(tenantId: string, code: string) {
    switch (code) {
      case "TOTAL_REVENUE": {
        const invoices = await this.analyticsRepo.findInvoicesForDrilldown(tenantId, 50);
        return {
          code,
          columns: ["invoiceNumber", "totalAmount", "status", "issueDate"],
          rows: invoices.map((i) => ({
            invoiceNumber: i.invoiceNumber,
            totalAmount: Number(i.totalAmount),
            status: i.status,
            issueDate: i.issueDate.toISOString().slice(0, 10),
          })),
        };
      }
      case "TOTAL_EMPLOYEES": {
        const employees = await this.analyticsRepo.findEmployeesForDrilldown(tenantId, 100);
        return {
          code,
          columns: ["employeeCode", "name", "email", "status"],
          rows: employees.map((e) => ({
            employeeCode: e.employeeCode,
            name: `${e.firstName} ${e.lastName}`,
            email: e.email,
            status: e.status,
          })),
        };
      }
      case "TOTAL_PRODUCTS": {
        const products = await this.analyticsRepo.findProductsForDrilldown(tenantId, 100);
        return {
          code,
          columns: ["sku", "name", "category", "sellPrice", "isActive"],
          rows: products.map((p) => ({
            sku: p.sku,
            name: p.name,
            category: p.category || "—",
            sellPrice: Number(p.sellPrice),
            isActive: p.isActive,
          })),
        };
      }
      default:
        throw new BadRequestException(
          `No drill-down available for KPI '${code}'`,
        );
    }
  }

  async getInsights(tenantId: string) {
    const insights: Array<{
      id: string;
      category: string;
      severity: "critical" | "warning" | "info";
      title: string;
      detail: string;
      metric?: string;
    }> = [];

    const invoices = await this.analyticsRepo.findInvoicesForInsights(tenantId);

    // Revenue trend anomaly (monthly z-score)
    const monthly = new Map<string, number>();
    for (const inv of invoices) {
      const key = inv.issueDate.toISOString().slice(0, 7);
      monthly.set(key, (monthly.get(key) || 0) + Number(inv.totalAmount));
    }
    const series = [...monthly.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );

    if (series.length >= 3) {
      const vals = series.map(([, v]) => v);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance =
        vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
      const std = Math.sqrt(variance);

      if (std > 0) {
        const lastItem = series[series.length - 1];
        if (lastItem) {
          const [lastMonth, lastVal] = lastItem;
          const z = (lastVal - mean) / std;

          if (z < -1.5) {
            insights.push({
              id: "rev-drop-anomaly",
              category: "revenue",
              severity: z < -2.0 ? "critical" : "warning",
              title: `Revenue Dip in ${lastMonth}`,
              detail: `Monthly revenue of $${Math.round(lastVal).toLocaleString()} is ${Math.abs(Math.round(z * 10) / 10)} standard deviations below the trailing mean ($${Math.round(mean).toLocaleString()}).`,
              metric: `${Math.round(((lastVal - mean) / mean) * 100)}% vs mean`,
            });
          } else if (z > 1.5) {
            insights.push({
              id: "rev-spike",
              category: "revenue",
              severity: "info",
              title: `Revenue Surge in ${lastMonth}`,
              detail: `Monthly revenue of $${Math.round(lastVal).toLocaleString()} is ${Math.round(z * 10) / 10} std devs above the trailing mean.`,
              metric: `+${Math.round(((lastVal - mean) / mean) * 100)}% vs mean`,
            });
          }
        }
      }
    }

    // Overdue receivables
    const now = new Date();
    const overdue = invoices.filter(
      (i) =>
        i.dueDate &&
        new Date(i.dueDate) < now &&
        i.status !== "PAID" &&
        i.status !== "CANCELLED",
    );
    if (overdue.length > 0) {
      const overdueTotal = overdue.reduce(
        (s, i) => s + (Number(i.totalAmount) - Number(i.paidAmount || 0)),
        0,
      );
      insights.push({
        id: "overdue-ar",
        category: "collections",
        severity: overdueTotal > 50000 ? "critical" : "warning",
        title: `${overdue.length} Overdue Invoices`,
        detail: `$${Math.round(overdueTotal).toLocaleString()} in receivables is past due across ${overdue.length} customer invoices.`,
        metric: `$${Math.round(overdueTotal).toLocaleString()}`,
      });
    }

    // Product margins
    const products = await this.analyticsRepo.findLowMarginProducts(tenantId, 20);
    const lowMargin = products.filter(
      (p) =>
        p.costPrice != null &&
        Number(p.costPrice) > 0 &&
        Number(p.sellPrice) <= Number(p.costPrice),
    );
    if (lowMargin.length > 0) {
      insights.push({
        id: "negative-margin-products",
        category: "pricing",
        severity: "warning",
        title: `${lowMargin.length} Products Selling at or Below Cost`,
        detail: `SKUs [${lowMargin.slice(0, 3).map((p) => p.sku).join(", ")}${lowMargin.length > 3 ? "…" : ""}] have sell price ≤ cost price.`,
      });
    }

    return insights;
  }

  async exportDataset(tenantId: string, dataset: string) {
    let columns: string[] = [];
    let rows: Array<Record<string, unknown>> = [];

    switch (dataset) {
      case "invoices": {
        const data = await this.analyticsRepo.findInvoicesForExport(tenantId);
        columns = [
          "invoiceNumber",
          "totalAmount",
          "paidAmount",
          "status",
          "issueDate",
          "dueDate",
        ];
        rows = data.map((d) => ({
          invoiceNumber: d.invoiceNumber,
          totalAmount: Number(d.totalAmount),
          paidAmount: Number(d.paidAmount || 0),
          status: d.status,
          issueDate: d.issueDate.toISOString().slice(0, 10),
          dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : "",
        }));
        break;
      }
      case "products": {
        const data = await this.analyticsRepo.findProductsForExport(tenantId);
        columns = [
          "sku",
          "name",
          "category",
          "costPrice",
          "sellPrice",
          "isActive",
        ];
        rows = data.map((d) => ({
          sku: d.sku,
          name: d.name,
          category: d.category || "",
          costPrice: Number(d.costPrice),
          sellPrice: Number(d.sellPrice),
          isActive: d.isActive,
        }));
        break;
      }
      case "employees": {
        const data = await this.analyticsRepo.findEmployeesForExport(tenantId);
        columns = [
          "employeeCode",
          "firstName",
          "lastName",
          "email",
          "designation",
          "status",
        ];
        rows = data.map((d) => ({
          employeeCode: d.employeeCode,
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email,
          designation: d.designation || "",
          status: d.status,
        }));
        break;
      }
      default:
        throw new BadRequestException(`Unknown export dataset '${dataset}'`);
    }

    const csv = this.toCsv(columns, rows);
    return {
      filename: `${dataset}-export-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: "text/csv",
      rowCount: rows.length,
      content: csv,
    };
  }

  private toCsv(
    columns: string[],
    rows: Array<Record<string, unknown>>,
  ): string {
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.map(escape).join(",");
    const body = rows
      .map((r) => columns.map((c) => escape(r[c])).join(","))
      .join("\n");
    return body ? `${header}\n${body}` : header;
  }

  async updateDashboard(
    tenantId: string,
    id: string,
    dto: UpdateDashboardRequest,
  ) {
    const existing = await this.analyticsRepo.findDashboardById(tenantId, id);
    if (!existing) throw new BadRequestException("Dashboard not found");

    return this.analyticsRepo.updateDashboard(tenantId, id, dto);
  }

  async deleteDashboard(tenantId: string, id: string) {
    const existing = await this.analyticsRepo.findDashboardById(tenantId, id);
    if (!existing) throw new BadRequestException("Dashboard not found");
    return this.analyticsRepo.deleteDashboard(tenantId, id);
  }

  async deleteReport(tenantId: string, id: string) {
    const existing = await this.analyticsRepo.findSimpleReportById(tenantId, id);
    if (!existing) throw new BadRequestException("Report not found");
    return this.analyticsRepo.deleteReport(tenantId, id);
  }

  async executePivotQuery(
    tenantId: string,
    reportId: string,
    dto: ExecutePivotQueryRequest,
  ) {
    const report = await this.analyticsRepo.findSimpleReportById(tenantId, reportId);
    if (!report) throw new BadRequestException("Report not found");

    const rowField = dto.rowFields?.[0] || "Quarter";
    const colField = dto.colFields?.[0] || "Status";
    const firstAgg = dto.aggregations?.[0];
    const aggregation =
      typeof firstAgg === "string"
        ? firstAgg
        : firstAgg && typeof firstAgg === "object" && "fn" in firstAgg
          ? `${firstAgg.fn}(${firstAgg.field})`
          : "SUM(totalAmount)";

    const pivotData = await this.analyticsRepo.executePivotAggregation(
      tenantId,
      rowField,
      colField,
      aggregation,
    );

    return {
      reportId,
      config: dto,
      pivotData,
    };
  }

  async runSecureVisualQuery(
    tenantId: string,
    dto: ExecuteVisualQueryRequest,
  ) {
    const invoices = await this.analyticsRepo.executeVisualQueryScan(
      tenantId,
      dto.selectFields,
      20,
    );

    return {
      success: true,
      fields: dto.selectFields,
      rows: invoices.map((inv) => {
        const rowData: Record<string, unknown> = {};
        dto.selectFields.forEach((field) => {
          if (field in inv) {
            rowData[field] = (inv as Record<string, unknown>)[field];
          }
        });
        return rowData;
      }),
    };
  }
}
