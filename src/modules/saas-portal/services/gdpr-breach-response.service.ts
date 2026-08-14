import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { Prisma } from "@prisma/client";

export interface BreachRecord {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "DETECTED" | "ASSESSING" | "CONTAINED" | "NOTIFIED" | "RESOLVED" | "CLOSED";
  detectedAt: Date;
  assessedAt?: Date;
  containedAt?: Date;
  notifiedAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  dataCategoriesAffected: string[];
  dataSubjectsAffected: number;
  lawfulBasisForProcessing: string;
  crossBorderTransfer: boolean;
  subProcessorsInvolved: string[];
  riskAssessment: string;
  mitigationActions: string[];
  notificationRequired: boolean;
  supervisoryAuthorityNotified: boolean;
  dataSubjectsNotified: boolean;
  dpoNotified: boolean;
  assignedTo: string;
  createdBy: string;
  updatedAt: Date;
}

export interface BreachTimelineEntry {
  id: string;
  breachId: string;
  timestamp: Date;
  action: string;
  details: string;
  performedBy: string;
}

@Injectable()
export class GdprBreachResponseService {
  private readonly logger = new Logger(GdprBreachResponseService.name);

  private readonly BREACH_NOTIFICATION_DEADLINE_HOURS = 72;

  async createBreachReport(
    tenantId: string,
    createdBy: string,
    data: {
      title: string;
      description: string;
      severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      dataCategoriesAffected: string[];
      dataSubjectsAffected: number;
      lawfulBasisForProcessing: string;
      crossBorderTransfer: boolean;
      subProcessorsInvolved: string[];
      riskAssessment: string;
      mitigationActions: string[];
    },
  ): Promise<BreachRecord> {
    const notificationRequired = data.severity === "HIGH" || data.severity === "CRITICAL";

    const breach = await prisma.dataBreach.create({
      data: {
        tenantId,
        title: data.title,
        description: data.description,
        severity: data.severity,
        status: "DETECTED",
        detectedAt: new Date(),
        dataCategoriesAffected: data.dataCategoriesAffected,
        dataSubjectsAffected: data.dataSubjectsAffected,
        lawfulBasisForProcessing: data.lawfulBasisForProcessing,
        crossBorderTransfer: data.crossBorderTransfer,
        subProcessorsInvolved: data.subProcessorsInvolved,
        riskAssessment: data.riskAssessment,
        mitigationActions: data.mitigationActions,
        notificationRequired,
        supervisoryAuthorityNotified: false,
        dataSubjectsNotified: false,
        dpoNotified: false,
        assignedTo: createdBy,
        createdBy,
      },
    });

    await this.addTimelineEntry(breach.id, {
      timestamp: new Date(),
      action: "BREACH_DETECTED",
      details: `Breach detected and reported: ${data.title}`,
      performedBy: createdBy,
    });

    this.logger.log(`Breach report created: ${breach.id} for tenant ${tenantId}`);

    return this.mapToBreachRecord(breach);
  }

  async assessBreach(
    tenantId: string,
    breachId: string,
    assessedBy: string,
    assessment: {
      riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      likelihoodOfHarm: string;
      severityOfHarm: string;
      additionalMitigation: string[];
    },
  ): Promise<BreachRecord> {
    const breach = await prisma.dataBreach.findFirst({
      where: { id: breachId, tenantId },
    });
    if (!breach) throw new Error("Breach not found");

    const updated = await prisma.dataBreach.update({
      where: { id: breachId },
      data: {
        status: "ASSESSING",
        assessedAt: new Date(),
        riskAssessment: assessment.riskLevel,
        mitigationActions: [
          ...breach.mitigationActions,
          ...assessment.additionalMitigation,
        ],
      },
    });

    await this.addTimelineEntry(breachId, {
      timestamp: new Date(),
      action: "RISK_ASSESSMENT_COMPLETED",
      details: `Risk level: ${assessment.riskLevel}. Likelihood: ${assessment.likelihoodOfHarm}. Severity: ${assessment.severityOfHarm}`,
      performedBy: assessedBy,
    });

    return this.mapToBreachRecord(updated);
  }

  async containBreach(
    tenantId: string,
    breachId: string,
    containedBy: string,
    containmentActions: string[],
  ): Promise<BreachRecord> {
    const breach = await prisma.dataBreach.findFirst({
      where: { id: breachId, tenantId },
    });
    if (!breach) throw new Error("Breach not found");

    const updated = await prisma.dataBreach.update({
      where: { id: breachId },
      data: {
        status: "CONTAINED",
        containedAt: new Date(),
        mitigationActions: [...breach.mitigationActions, ...containmentActions],
      },
    });

    await this.addTimelineEntry(breachId, {
      timestamp: new Date(),
      action: "BREACH_CONTAINED",
      details: `Containment actions: ${containmentActions.join("; ")}`,
      performedBy: containedBy,
    });

    return this.mapToBreachRecord(updated);
  }

  async notifySupervisoryAuthority(
    tenantId: string,
    breachId: string,
    notifiedBy: string,
    details: {
      authorityName: string;
      notificationMethod: string;
      referenceNumber: string;
    },
  ): Promise<BreachRecord> {
    const breach = await prisma.dataBreach.findFirst({
      where: { id: breachId, tenantId },
    });
    if (!breach) throw new Error("Breach not found");

    const updated = await prisma.dataBreach.update({
      where: { id: breachId },
      data: {
        status: "NOTIFIED",
        notifiedAt: new Date(),
        supervisoryAuthorityNotified: true,
      },
    });

    await this.addTimelineEntry(breachId, {
      timestamp: new Date(),
      action: "SUPERVISORY_AUTHORITY_NOTIFIED",
      details: `Notified ${details.authorityName} via ${details.notificationMethod}. Ref: ${details.referenceNumber}`,
      performedBy: notifiedBy,
    });

    return this.mapToBreachRecord(updated);
  }

  async notifyDataSubjects(
    tenantId: string,
    breachId: string,
    notifiedBy: string,
    details: {
      notificationMethod: string;
      affectedSubjectCount: number;
    },
  ): Promise<BreachRecord> {
    const breach = await prisma.dataBreach.findFirst({
      where: { id: breachId, tenantId },
    });
    if (!breach) throw new Error("Breach not found");

    const updated = await prisma.dataBreach.update({
      where: { id: breachId },
      data: {
        dataSubjectsNotified: true,
      },
    });

    await this.addTimelineEntry(breachId, {
      timestamp: new Date(),
      action: "DATA_SUBJECTS_NOTIFIED",
      details: `Notified ${details.affectedSubjectCount} data subjects via ${details.notificationMethod}`,
      performedBy: notifiedBy,
    });

    return this.mapToBreachRecord(updated);
  }

  async notifyDpo(
    tenantId: string,
    breachId: string,
    notifiedBy: string,
  ): Promise<BreachRecord> {
    const breach = await prisma.dataBreach.findFirst({
      where: { id: breachId, tenantId },
    });
    if (!breach) throw new Error("Breach not found");

    const updated = await prisma.dataBreach.update({
      where: { id: breachId },
      data: {
        dpoNotified: true,
      },
    });

    await this.addTimelineEntry(breachId, {
      timestamp: new Date(),
      action: "DPO_NOTIFIED",
      details: "Data Protection Officer notified of breach",
      performedBy: notifiedBy,
    });

    return this.mapToBreachRecord(updated);
  }

  async resolveBreach(
    tenantId: string,
    breachId: string,
    resolvedBy: string,
    resolution: string,
  ): Promise<BreachRecord> {
    const breach = await prisma.dataBreach.findFirst({
      where: { id: breachId, tenantId },
    });
    if (!breach) throw new Error("Breach not found");

    const updated = await prisma.dataBreach.update({
      where: { id: breachId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        mitigationActions: [...breach.mitigationActions, resolution],
      },
    });

    await this.addTimelineEntry(breachId, {
      timestamp: new Date(),
      action: "BREACH_RESOLVED",
      details: `Resolution: ${resolution}`,
      performedBy: resolvedBy,
    });

    return this.mapToBreachRecord(updated);
  }

  async closeBreach(
    tenantId: string,
    breachId: string,
    closedBy: string,
    closureNotes: string,
  ): Promise<BreachRecord> {
    const breach = await prisma.dataBreach.findFirst({
      where: { id: breachId, tenantId },
    });
    if (!breach) throw new Error("Breach not found");

    const updated = await prisma.dataBreach.update({
      where: { id: breachId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
      },
    });

    await this.addTimelineEntry(breachId, {
      timestamp: new Date(),
      action: "BREACH_CLOSED",
      details: `Closure notes: ${closureNotes}`,
      performedBy: closedBy,
    });

    return this.mapToBreachRecord(updated);
  }

  async getBreach(tenantId: string, breachId: string): Promise<BreachRecord | null> {
    const breach = await prisma.dataBreach.findFirst({
      where: { id: breachId, tenantId },
      include: { timeline: { orderBy: { timestamp: "asc" } } },
    });
    if (!breach) return null;
    return this.mapToBreachRecord(breach);
  }

  async getBreaches(tenantId: string, filters?: {
    status?: string;
    severity?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<BreachRecord[]> {
    const where: Prisma.DataBreachWhereInput = { tenantId };
    if (filters?.status) where.status = filters.status as any;
    if (filters?.severity) where.severity = filters.severity as any;
    if (filters?.dateFrom || filters?.dateTo) {
      where.detectedAt = {};
      if (filters.dateFrom) where.detectedAt.gte = filters.dateFrom;
      if (filters.dateTo) where.detectedAt.lte = filters.dateTo;
    }

    const breaches = await prisma.dataBreach.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      include: { timeline: { orderBy: { timestamp: "asc" } } },
    });

    return breaches.map(this.mapToBreachRecord);
  }

  async getOverdueNotifications(tenantId: string): Promise<BreachRecord[]> {
    const deadline = new Date(Date.now() - this.BREACH_NOTIFICATION_DEADLINE_HOURS * 60 * 60 * 1000);
    const breaches = await prisma.dataBreach.findMany({
      where: {
        tenantId,
        notificationRequired: true,
        supervisoryAuthorityNotified: false,
        detectedAt: { lte: deadline },
        status: { notIn: ["CLOSED", "RESOLVED"] },
      },
    });

    return breaches.map(this.mapToBreachRecord);
  }

  async getBreachStatistics(tenantId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    overdueNotifications: number;
    avgTimeToNotification: number;
    avgTimeToResolution: number;
  }> {
    const breaches = await prisma.dataBreach.findMany({
      where: { tenantId },
    });

    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let totalNotificationTime = 0;
    let notifiedCount = 0;
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const breach of breaches) {
      byStatus[breach.status] = (byStatus[breach.status] || 0) + 1;
      bySeverity[breach.severity] = (bySeverity[breach.severity] || 0) + 1;

      if (breach.notifiedAt && breach.detectedAt) {
        totalNotificationTime += breach.notifiedAt.getTime() - breach.detectedAt.getTime();
        notifiedCount++;
      }
      if (breach.resolvedAt && breach.detectedAt) {
        totalResolutionTime += breach.resolvedAt.getTime() - breach.detectedAt.getTime();
        resolvedCount++;
      }
    }

    return {
      total: breaches.length,
      byStatus,
      bySeverity,
      overdueNotifications: await this.getOverdueNotifications(tenantId).then(r => r.length),
      avgTimeToNotification: notifiedCount > 0 ? totalNotificationTime / notifiedCount / (60 * 60 * 1000) : 0,
      avgTimeToResolution: resolvedCount > 0 ? totalResolutionTime / resolvedCount / (60 * 60 * 1000) : 0,
    };
  }

  private async addTimelineEntry(
    breachId: string,
    entry: Omit<BreachTimelineEntry, "id" | "breachId">,
  ) {
    await prisma.dataBreachTimeline.create({
      data: {
        breachId,
        ...entry,
      },
    });
  }

  private mapToBreachRecord(breach: any): BreachRecord {
    return {
      id: breach.id,
      tenantId: breach.tenantId,
      title: breach.title,
      description: breach.description,
      severity: breach.severity,
      status: breach.status,
      detectedAt: breach.detectedAt,
      assessedAt: breach.assessedAt,
      containedAt: breach.containedAt,
      notifiedAt: breach.notifiedAt,
      resolvedAt: breach.resolvedAt,
      closedAt: breach.closedAt,
      dataCategoriesAffected: breach.dataCategoriesAffected,
      dataSubjectsAffected: breach.dataSubjectsAffected,
      lawfulBasisForProcessing: breach.lawfulBasisForProcessing,
      crossBorderTransfer: breach.crossBorderTransfer,
      subProcessorsInvolved: breach.subProcessorsInvolved,
      riskAssessment: breach.riskAssessment,
      mitigationActions: breach.mitigationActions,
      notificationRequired: breach.notificationRequired,
      supervisoryAuthorityNotified: breach.supervisoryAuthorityNotified,
      dataSubjectsNotified: breach.dataSubjectsNotified,
      dpoNotified: breach.dpoNotified,
      assignedTo: breach.assignedTo,
      createdBy: breach.createdBy,
      updatedAt: breach.updatedAt,
    };
  }
}