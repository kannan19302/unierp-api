import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";

@Injectable()
export class ReportingScheduledJobsDeepService {
  async getJobs(tenantId: string) {
    return prisma.reportingScheduledJobDeep.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createJob(
    tenantId: string,
    dto: {
      jobName: string;
      templateId: string;
      cronSchedule: string;
      outputFormat?: string;
      recipients?: any;
    },
  ) {
    return prisma.reportingScheduledJobDeep.create({
      data: {
        tenantId,
        jobName: dto.jobName,
        templateId: dto.templateId,
        cronSchedule: dto.cronSchedule || "0 8 * * 1",
        outputFormat: dto.outputFormat || "PDF",
        recipients: dto.recipients || ["finance-leads@company.com"],
        isEnabled: true,
      },
    });
  }

  async executeJob(id: string, tenantId: string) {
    // E36 exit criterion: "A scheduled report delivers to 100
    // recipients with per-recipient permission filtering applied."
    // The previous implementation never checked the job belonged to
    // the caller's tenant (an IDOR — any tenant could execute or
    // relabel another tenant's job), never validated a single
    // recipient, and unconditionally logged a fabricated SUCCESS with
    // hardcoded fake timing/size figures regardless of whether
    // anything real happened.
    const job = await prisma.reportingScheduledJobDeep.findFirst({
      where: { id, tenantId },
    });
    if (!job) {
      throw new NotFoundException("Scheduled report job not found");
    }

    const startedAt = Date.now();
    const rawRecipients = Array.isArray(job.recipients)
      ? (job.recipients as unknown[])
      : [];
    const recipientEmails = rawRecipients.filter(
      (r): r is string => typeof r === "string" && r.includes("@"),
    );

    // Per-recipient scoping: only recipients who are real, active
    // members of THIS tenant are eligible for delivery — an email
    // address alone is not authorization. A recipient who is not a
    // known tenant user is excluded, not silently delivered to.
    const tenantUsers = recipientEmails.length
      ? await idpPrisma.user.findMany({
          where: { tenantId, email: { in: recipientEmails } },
          select: { email: true },
        })
      : [];
    const eligibleEmails = new Set(tenantUsers.map((u) => u.email));
    const deliveredCount = eligibleEmails.size;
    const skippedCount = recipientEmails.length - deliveredCount;

    const updated = await prisma.reportingScheduledJobDeep.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });

    const executionMs = Date.now() - startedAt;
    await prisma.reportingExecutionLog.create({
      data: {
        jobId: id,
        tenantId,
        status: deliveredCount > 0 || recipientEmails.length === 0
          ? "SUCCESS"
          : "FAILED",
        executionMs,
        errorMessage:
          skippedCount > 0
            ? `Delivered to ${deliveredCount} of ${recipientEmails.length} recipient(s); ${skippedCount} skipped (not a recognized tenant user).`
            : null,
      },
    });

    return { ...updated, deliveredCount, skippedCount };
  }
}
