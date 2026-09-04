import { Injectable } from "@nestjs/common";
import { AnalyticsRepository } from "../repositories/analytics.repository";

@Injectable()
export class AnalyticsAnomalyDetectionDeepService {
  constructor(private readonly analyticsRepo: AnalyticsRepository) {}

  async getAnomalies(tenantId: string) {
    const anomalies: Array<{
      id: string;
      tenantId: string;
      metric: string;
      severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      deviationPercent: string;
      detectedAt: string;
      status: "INVESTIGATING" | "RESOLVED" | "DETECTED";
      details?: string;
    }> = [];

    const invoices = await this.analyticsRepo.findInvoicesForInsights(tenantId);
    if (invoices.length > 0) {
      const amounts = invoices.map((i) => Number(i.totalAmount || 0));
      const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const variance =
        amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
      const stdDev = Math.sqrt(variance);

      // Detect transaction spikes (Z-score > 2.5)
      if (stdDev > 0) {
        for (const inv of invoices) {
          const val = Number(inv.totalAmount || 0);
          const zScore = (val - mean) / stdDev;
          if (zScore > 2.5) {
            anomalies.push({
              id: `anom-inv-${inv.invoiceNumber}`,
              tenantId,
              metric: "TRANSACTION_AMOUNT_SPIKE",
              severity: zScore > 3.5 ? "CRITICAL" : "HIGH",
              deviationPercent: `+${Math.round(zScore * 100)}%`,
              detectedAt: inv.issueDate.toISOString(),
              status: "DETECTED",
              details: `Invoice ${inv.invoiceNumber} ($${val.toLocaleString()}) deviates by ${zScore.toFixed(1)}σ from the mean ($${Math.round(mean).toLocaleString()}).`,
            });
          }
        }
      }

      // Detect overdue payment accumulation
      const now = new Date();
      const overdue = invoices.filter(
        (i) =>
          i.dueDate &&
          new Date(i.dueDate) < now &&
          i.status !== "PAID" &&
          i.status !== "CANCELLED",
      );
      if (overdue.length > 3) {
        const overdueRatio = (overdue.length / invoices.length) * 100;
        if (overdueRatio > 25) {
          anomalies.push({
            id: `anom-overdue-rate`,
            tenantId,
            metric: "OVERDUE_INVOICE_RATIO",
            severity: overdueRatio > 50 ? "CRITICAL" : "MEDIUM",
            deviationPercent: `+${Math.round(overdueRatio)}%`,
            detectedAt: new Date().toISOString(),
            status: "INVESTIGATING",
            details: `${overdue.length} out of ${invoices.length} invoices are past due.`,
          });
        }
      }
    }

    // Check negative margin products
    const products = await this.analyticsRepo.findLowMarginProducts(tenantId, 10);
    const negativeMargin = products.filter(
      (p) =>
        p.costPrice != null &&
        Number(p.costPrice) > 0 &&
        Number(p.sellPrice) < Number(p.costPrice),
    );
    if (negativeMargin.length > 0) {
      anomalies.push({
        id: `anom-margin-inversion`,
        tenantId,
        metric: "PRODUCT_MARGIN_INVERSION",
        severity: "HIGH",
        deviationPercent: "-100%",
        detectedAt: new Date().toISOString(),
        status: "INVESTIGATING",
        details: `${negativeMargin.length} active products have selling price below cost basis.`,
      });
    }

    return anomalies;
  }
}
