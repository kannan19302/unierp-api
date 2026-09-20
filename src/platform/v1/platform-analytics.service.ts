import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";

export type WidgetType = "KPI_CARD" | "LINE_CHART" | "BAR_CHART" | "DATA_TABLE";

export interface DashboardWidget {
  id: string;
  title: string;
  type: WidgetType;
  metric: string;
  dimension?: string;
  gridSpan: number; // 1 to 4 columns
  config?: Record<string, unknown>;
}

export interface CustomDashboard {
  id: string;
  name: string;
  description?: string;
  category: "REVENUE" | "OPERATIONS" | "SECURITY" | "USAGE";
  isDefault?: boolean;
  widgets: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
}

export interface ReportSchedule {
  id: string;
  name: string;
  dashboardId?: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  format: "PDF" | "CSV" | "EXCEL";
  recipients: string[];
  status: "ACTIVE" | "PAUSED";
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
}

export interface AnomalyAlert {
  id: string;
  metric: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  currentValue: number;
  expectedThreshold: number;
  detectedAt: string;
  summary: string;
}

@Injectable()
export class PlatformAnalyticsService {
  private dashboards: CustomDashboard[] = [
    {
      id: "dash-exec-revenue",
      name: "Executive Revenue & Churn Radar",
      description: "Core SaaS ARR, MRR, expansion velocity and logo retention metrics.",
      category: "REVENUE",
      isDefault: true,
      widgets: [
        { id: "w-1", title: "Current MRR", type: "KPI_CARD", metric: "MRR", gridSpan: 1 },
        { id: "w-2", title: "Logo Churn Rate", type: "KPI_CARD", metric: "CHURN_RATE", gridSpan: 1 },
        { id: "w-3", title: "Seat Utilization", type: "KPI_CARD", metric: "SEAT_UTILIZATION", gridSpan: 1 },
        { id: "w-4", title: "12-Month ARR Trajectory", type: "LINE_CHART", metric: "ARR", gridSpan: 2 },
        { id: "w-5", title: "Cohort Retention Breakdown", type: "BAR_CHART", metric: "RETENTION", gridSpan: 2 },
      ],
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-03-10T12:00:00Z",
    },
    {
      id: "dash-platform-ops",
      name: "Control Plane Fleet Latency & Compute",
      description: "Kubernetes pod telemetry, request latency percentiles, and API throughput.",
      category: "OPERATIONS",
      isDefault: false,
      widgets: [
        { id: "w-6", title: "API p99 Latency", type: "KPI_CARD", metric: "API_LATENCY", gridSpan: 1 },
        { id: "w-7", title: "Error Rate (5xx)", type: "KPI_CARD", metric: "ERROR_RATE", gridSpan: 1 },
        { id: "w-8", title: "Hourly Request Throughput", type: "BAR_CHART", metric: "THROUGHPUT", gridSpan: 2 },
        { id: "w-9", title: "Database Connection Pool", type: "DATA_TABLE", metric: "DB_POOL", gridSpan: 4 },
      ],
      createdAt: "2026-02-15T00:00:00Z",
      updatedAt: "2026-03-12T14:30:00Z",
    },
  ];

  private reportSchedules: ReportSchedule[] = [
    {
      id: "sched-exec-weekly",
      name: "Weekly Executive SaaS Performance Brief",
      dashboardId: "dash-exec-revenue",
      frequency: "WEEKLY",
      format: "PDF",
      recipients: ["exec-team@unierp.com", "board@unierp.com"],
      status: "ACTIVE",
      lastRunAt: "2026-03-16T08:00:00Z",
      nextRunAt: "2026-03-23T08:00:00Z",
      createdAt: "2026-02-10T09:00:00Z",
    },
    {
      id: "sched-ops-daily-csv",
      name: "Daily Platform Capacity & Ingestion Dump",
      dashboardId: "dash-platform-ops",
      frequency: "DAILY",
      format: "CSV",
      recipients: ["finops@unierp.com", "devops@unierp.com"],
      status: "ACTIVE",
      lastRunAt: "2026-03-20T00:00:00Z",
      nextRunAt: "2026-03-21T00:00:00Z",
      createdAt: "2026-02-18T10:00:00Z",
    },
    {
      id: "sched-compliance-monthly",
      name: "Monthly Tenant Offboarding & Retention Audit",
      frequency: "MONTHLY",
      format: "EXCEL",
      recipients: ["compliance@unierp.com"],
      status: "PAUSED",
      lastRunAt: "2026-03-01T00:00:00Z",
      nextRunAt: "2026-04-01T00:00:00Z",
      createdAt: "2026-01-05T12:00:00Z",
    },
  ];

  private anomalyAlerts: AnomalyAlert[] = [
    {
      id: "alert-1",
      metric: "API_LATENCY",
      severity: "WARNING",
      currentValue: 342,
      expectedThreshold: 150,
      detectedAt: "2026-03-20T14:15:00Z",
      summary: "North America control plane p99 latency elevated above baseline threshold.",
    },
    {
      id: "alert-2",
      metric: "TOKEN_USAGE",
      severity: "CRITICAL",
      currentValue: 920000,
      expectedThreshold: 750000,
      detectedAt: "2026-03-20T13:40:00Z",
      summary: "Tenant Acme Corp exceeded 90% of daily AI rate cap in 4 hours.",
    },
  ];

  // ── Dashboard Composer (EC-16.1) ──

  async listDashboards(): Promise<CustomDashboard[]> {
    return this.dashboards;
  }

  async getDashboard(id: string): Promise<CustomDashboard> {
    const d = this.dashboards.find((item) => item.id === id);
    if (!d) throw new NotFoundException(`Dashboard ${id} not found`);
    return d;
  }

  async createDashboard(input: {
    name: string;
    description?: string;
    category?: "REVENUE" | "OPERATIONS" | "SECURITY" | "USAGE";
    widgets: DashboardWidget[];
  }): Promise<CustomDashboard> {
    if (!input.name || !input.name.trim()) throw new BadRequestException("Dashboard name is required");
    const newDash: CustomDashboard = {
      id: `dash-${Date.now()}`,
      name: input.name.trim(),
      description: input.description?.trim(),
      category: input.category ?? "REVENUE",
      widgets: input.widgets ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.dashboards.unshift(newDash);
    return newDash;
  }

  async updateDashboard(
    id: string,
    input: Partial<Pick<CustomDashboard, "name" | "description" | "category" | "widgets">>
  ): Promise<CustomDashboard> {
    const idx = this.dashboards.findIndex((item) => item.id === id);
    if (idx === -1) throw new NotFoundException(`Dashboard ${id} not found`);
    this.dashboards[idx] = {
      ...this.dashboards[idx],
      ...input,
      updatedAt: new Date().toISOString(),
    };
    return this.dashboards[idx];
  }

  async deleteDashboard(id: string): Promise<{ success: boolean }> {
    const before = this.dashboards.length;
    this.dashboards = this.dashboards.filter((item) => item.id !== id);
    return { success: this.dashboards.length < before };
  }

  // ── Report Scheduler (EC-16.2) ──

  async listReportSchedules(): Promise<ReportSchedule[]> {
    return this.reportSchedules;
  }

  async createReportSchedule(input: {
    name: string;
    dashboardId?: string;
    frequency: "DAILY" | "WEEKLY" | "MONTHLY";
    format: "PDF" | "CSV" | "EXCEL";
    recipients: string[];
  }): Promise<ReportSchedule> {
    if (!input.name || !input.name.trim()) throw new BadRequestException("Schedule name is required");
    if (!input.recipients || input.recipients.length === 0) {
      throw new BadRequestException("At least one recipient email is required");
    }

    const nextRun = new Date(Date.now() + 86400000).toISOString();
    const newSchedule: ReportSchedule = {
      id: `sched-${Date.now()}`,
      name: input.name.trim(),
      dashboardId: input.dashboardId,
      frequency: input.frequency,
      format: input.format,
      recipients: input.recipients,
      status: "ACTIVE",
      nextRunAt: nextRun,
      createdAt: new Date().toISOString(),
    };
    this.reportSchedules.unshift(newSchedule);
    return newSchedule;
  }

  async toggleReportSchedule(id: string): Promise<ReportSchedule> {
    const schedule = this.reportSchedules.find((s) => s.id === id);
    if (!schedule) throw new NotFoundException(`Report schedule ${id} not found`);
    schedule.status = schedule.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    return schedule;
  }

  async triggerReportRun(id: string): Promise<{ success: boolean; executedAt: string }> {
    const schedule = this.reportSchedules.find((s) => s.id === id);
    if (!schedule) throw new NotFoundException(`Report schedule ${id} not found`);
    schedule.lastRunAt = new Date().toISOString();
    return { success: true, executedAt: schedule.lastRunAt };
  }

  // ── Platform Intelligence & Anomaly Alerts ──

  async getPlatformMetrics() {
    return {
      availableMetrics: [
        { key: "MRR", name: "Monthly Recurring Revenue", unit: "USD", category: "FINANCIAL" },
        { key: "ARR", name: "Annual Recurring Revenue", unit: "USD", category: "FINANCIAL" },
        { key: "CHURN_RATE", name: "Monthly Logo Churn Rate", unit: "%", category: "FINANCIAL" },
        { key: "SEAT_UTILIZATION", name: "Seat Quota Utilization", unit: "%", category: "USAGE" },
        { key: "API_LATENCY", name: "Roundtrip API Latency (p99)", unit: "ms", category: "PERFORMANCE" },
        { key: "ERROR_RATE", name: "5xx HTTP Error Rate", unit: "%", category: "PERFORMANCE" },
        { key: "TOKEN_USAGE", name: "AI Foundation Model Token Volume", unit: "Tokens", category: "USAGE" },
      ],
      anomalyAlerts: this.anomalyAlerts,
    };
  }
}
