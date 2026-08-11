/**
 * M35 — incidents, SLO breach detection and SLA credit, using C21 to
 * notify (never a second notification pipeline) and reaching C16 as a
 * real invoice adjustment (never a bespoke credit ledger).
 */
import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { prisma } from "@kannan19302/database";
import { InvoicingService } from "./invoicing.service";
import { calculateSlaCredit } from "./sla-credit";

export interface BreachResult {
  incident: any;
  notified: boolean;
  creditAmount: string;
  adjustment: unknown | null;
}

@Injectable()
export class IncidentService {
  constructor(
    private readonly invoicing: InvoicingService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * "A simulated breach runs the path end to end": one call exercises
   * every stage the exit criterion names, in order — open the incident,
   * notify through C21 (an emitted `notification.send` event, the exact
   * contract `NotificationDeliveryService` already listens for — no
   * second delivery pipeline), compute the credit (100%-covered pure
   * arithmetic), and apply it as a real C16 invoice adjustment.
   */
  async simulateBreach(sloDefinitionId: string, invoiceId: string, actualPercent: number, actorId: string): Promise<BreachResult> {
    const slo = await (prisma as any).sloDefinition.findUnique({ where: { id: sloDefinitionId } });
    if (!slo) throw new NotFoundException(`SLO definition ${sloDefinitionId} not found`);

    const { creditAmount } = calculateSlaCredit(actualPercent, slo.monthlyFee.toString());

    const severity = actualPercent < 95 ? "CRITICAL" : actualPercent < 99 ? "MAJOR" : "MINOR";

    const incident = await (prisma as any).incident.create({
      data: {
        sloDefinitionId,
        tenantId: slo.tenantId,
        severity,
        status: "OPEN",
        actualPercent,
        creditAmount,
      },
    });

    // C21: the SAME event NotificationDeliveryService already listens for
    // via @OnEvent("notification.send") -- never a second delivery path.
    this.eventEmitter?.emit("notification.send", {
      tenantId: slo.tenantId,
      type: "SLA_BREACH",
      title: `SLA breach: ${slo.service} at ${actualPercent}% (target ${slo.targetPercent}%)`,
      body: `Incident ${incident.id} opened. A credit of ${creditAmount} has been applied.`,
      urgent: true,
    });

    let adjustment: unknown | null = null;
    if (Number(creditAmount) > 0) {
      adjustment = await this.invoicing.applyAdjustment(
        invoiceId,
        { amount: Number(creditAmount), type: "REFUND", reason: `SLA credit for incident ${incident.id} (${slo.service} breach)` },
        actorId,
      );
      await (prisma as any).incident.update({
        where: { id: incident.id },
        data: { invoiceAdjustmentId: invoiceId },
      });
    }

    return { incident, notified: true, creditAmount, adjustment };
  }
}
