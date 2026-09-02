import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma, runWithTenantSession } from "@kannan19302/database";
import { idpClient as idpPrisma } from "../../../common/idp-client";
import * as fs from "fs";
import * as path from "path";
import { GdprCryptoShredService } from "./gdpr-crypto-shred.service";
import { RecordLegalHoldService } from "./record-legal-hold.service";

interface PiiModelEntry {
  treatment: "erase" | "anonymize" | "retain-legal-hold";
  rationale: string;
  reviewed: string;
}

interface PiiRegistry {
  comment: string;
  models: Record<string, PiiModelEntry>;
}

export interface ErasureResult {
  entityType: string;
  treatment: string;
  count: number;
  heldCount?: number;
}

/**
 * GDPR + platform-compliance home for the SaaS Portal. Consolidates
 * `/admin/gdpr` (retention policies, erasure requests, right-of-access
 * export) and `/saas/compliance` (report/certification/DPA status) into one
 * saas-portal surface. Independent implementation against the same
 * `DataRetentionPolicy`/`DataErasureRequest`/`AuditLog` Prisma models — see
 * `org-hierarchy.service.ts` for why this isn't a cross-module delegate.
 */
@Injectable()
export class SaasPortalGdprComplianceService {
  private readonly logger = new Logger(SaasPortalGdprComplianceService.name);
  private piiRegistry: PiiRegistry | null = null;

  constructor(
    private readonly cryptoShred: GdprCryptoShredService,
    private readonly legalHolds: RecordLegalHoldService,
  ) {}

  private readonly prismaModelMap: Record<string, string> = {
    User: "user",
    Organization: "organization",
    Employee: "employee",
    Customer: "customer",
    Vendor: "vendor",
    Contact: "contact",
    Lead: "lead",
    POSLoyaltyMember: "poSLoyaltyMember",
    Applicant: "applicant",
    CustomerPortalUser: "customerPortalUser",
    VendorPortalUser: "vendorPortalUser",
  };

  private readonly piiAnonymizeFields: Record<string, string[]> = {
    User: ["email", "firstName", "lastName", "avatar"],
    Organization: ["name", "legalName", "email", "phone"],
    Customer: ["name", "email", "phone"],
    Vendor: ["name", "email", "phone"],
  };

  private readonly aliasMap: Record<string, string> = {
    customers: "Customer",
    vendors: "Vendor",
    contacts: "Contact",
    leads: "Lead",
    employees: "Employee",
    users: "User",
    organizations: "Organization",
    posloyaltymembers: "POSLoyaltyMember",
    applicants: "Applicant",
    customerportalusers: "CustomerPortalUser",
    vendorportalusers: "VendorPortalUser",
  };

  /* ── PII Registry Loader ──────────────────────────────── */

  loadPiiRegistry(): PiiRegistry {
    if (this.piiRegistry) return this.piiRegistry;
    const registryPath =
      process.env.PII_REGISTRY_PATH ||
      path.resolve(process.cwd(), "scripts", "pii-registry.json");
    const raw = fs.readFileSync(registryPath, "utf-8");
    this.piiRegistry = JSON.parse(raw) as PiiRegistry;
    return this.piiRegistry;
  }

  private resolveModelName(entityType: string): string | null {
    const lower = entityType.toLowerCase();
    if (this.aliasMap[lower]) return this.aliasMap[lower];
    if (this.prismaModelMap[entityType]) return entityType;
    return null;
  }

  private async eraseRecords(
    modelName: string,
    tenantId: string,
    email: string,
  ): Promise<{ count: number; heldCount: number }> {
    const prismaKey = this.prismaModelMap[modelName];
    if (!prismaKey) return { count: 0, heldCount: 0 };
    const source = modelName === "User"
      ? idpPrisma as unknown as Record<string, unknown>
      : prisma as unknown as Record<string, unknown>;
    const model = source[prismaKey] as {
      findMany?: (args: {
        where: { tenantId: string; email: string };
        select: { id: true };
      }) => Promise<{ id: string }[]>;
      deleteMany?: (args: {
        where: { tenantId: string; email: string; id?: { in: string[] } };
      }) => Promise<{ count: number }>;
    };
    if (!model?.deleteMany || !model.findMany) return { count: 0, heldCount: 0 };

    const candidates = await model.findMany({
      where: { tenantId, email },
      select: { id: true },
    });
    const candidateIds = candidates.map((record) => record.id);
    const allowedIds = await this.legalHolds.excludeHeld(
      tenantId,
      modelName,
      candidateIds,
    );
    const heldCount = candidateIds.length - allowedIds.length;
    if (allowedIds.length === 0) return { count: 0, heldCount };

    // E32 exit criterion: "A GDPR erasure removes attachments too."
    // A User's identity record can be deleted while their uploaded
    // files/documents (createdBy = their user id) survive untouched —
    // those files are exactly the kind of personal data (uploaded
    // photos, ID scans, signed contracts) a subject-erasure request is
    // meant to reach. Capture the ids before deleting the User rows so
    // their attachments can be erased too, in the same call.
    const userIds = modelName === "User" ? allowedIds : [];

    const { count } = await model.deleteMany({
      where: { tenantId, email, id: { in: allowedIds } },
    });

    if (userIds.length > 0) {
      const [storedFiles, documents] = await Promise.all([
        prisma.storedFile.findMany({
          where: { tenantId, createdBy: { in: userIds } },
          select: { id: true },
        }),
        prisma.document.findMany({
          where: { tenantId, createdBy: { in: userIds }, legalHold: false },
          select: { id: true },
        }),
      ]);
      const [storedFileIds, documentIds] = await Promise.all([
        this.legalHolds.excludeHeld(tenantId, "StoredFile", storedFiles.map((file) => file.id)),
        this.legalHolds.excludeHeld(tenantId, "Document", documents.map((document) => document.id)),
      ]);
      if (storedFileIds.length) {
        await prisma.storedFile.deleteMany({ where: { tenantId, id: { in: storedFileIds } } });
      }
      if (documentIds.length) {
        await prisma.document.deleteMany({ where: { tenantId, id: { in: documentIds } } });
      }
    }

    return { count, heldCount };
  }

  private async anonymizeRecords(
    modelName: string,
    tenantId: string,
    email: string,
  ): Promise<{ count: number; heldCount: number }> {
    const prismaKey = this.prismaModelMap[modelName];
    if (!prismaKey) return { count: 0, heldCount: 0 };
    const source = modelName === "User"
      ? idpPrisma as unknown as Record<string, unknown>
      : prisma as unknown as Record<string, unknown>;
    const model = source[prismaKey] as {
      findMany?: (args: {
        where: { tenantId: string; email: string };
        select: { id: true };
      }) => Promise<{ id: string }[]>;
      update?: (args: {
        where: { id: string };
        data: Record<string, string>;
      }) => Promise<unknown>;
    };
    if (!model?.findMany) return { count: 0, heldCount: 0 };

    const records = await model.findMany({
      where: { tenantId, email },
      select: { id: true },
    });
    if (records.length === 0) return { count: 0, heldCount: 0 };

    const allowedIds = await this.legalHolds.excludeHeld(
      tenantId,
      modelName,
      records.map((record) => record.id),
    );
    const heldCount = records.length - allowedIds.length;
    if (!allowedIds.length) return { count: 0, heldCount };

    if (modelName === "User") {
      for (const id of allowedIds) {
        const [storedFiles, documents] = await Promise.all([
          prisma.storedFile.findMany({
            where: { tenantId, createdBy: id },
            select: { id: true },
          }),
          prisma.document.findMany({
            where: { tenantId, createdBy: id, legalHold: false },
            select: { id: true },
          }),
        ]);
        const [storedFileIds, documentIds] = await Promise.all([
          this.legalHolds.excludeHeld(tenantId, "StoredFile", storedFiles.map((file) => file.id)),
          this.legalHolds.excludeHeld(tenantId, "Document", documents.map((document) => document.id)),
        ]);
        await Promise.all([
          idpPrisma.userSession.deleteMany({ where: { userId: id } }),
          idpPrisma.userIdentity.deleteMany({ where: { userId: id } }),
          idpPrisma.userRole.deleteMany({ where: { userId: id } }),
          idpPrisma.userGroupMember.deleteMany({ where: { userId: id } }),
          idpPrisma.authApiToken.deleteMany({ where: { userId: id } }),
          idpPrisma.pushSubscription.deleteMany({ where: { userId: id } }),
          idpPrisma.passwordResetToken.deleteMany({ where: { userId: id } }),
          idpPrisma.emailVerificationToken.deleteMany({ where: { userId: id } }),
          idpPrisma.passkey.deleteMany({ where: { userId: id } }),
          idpPrisma.accountContact.deleteMany({ where: { userId: id } }),
          idpPrisma.userProfile.deleteMany({ where: { userId: id } }),
          storedFileIds.length
            ? prisma.storedFile.deleteMany({ where: { tenantId, id: { in: storedFileIds } } })
            : Promise.resolve({ count: 0 }),
          documentIds.length
            ? prisma.document.deleteMany({ where: { tenantId, id: { in: documentIds } } })
            : Promise.resolve({ count: 0 }),
        ]);
        await idpPrisma.user.update({
          where: { id },
          data: {
            email: `[redacted-${id}]@erased.local`,
            firstName: "[redacted]",
            lastName: "[redacted]",
            avatar: null,
            passwordHash: null,
            status: "ERASED",
            mfaEnabled: false,
            mfaSecret: null,
            mfaPending: false,
            mfaRecoveryCodes: [],
            preferences: {},
            deletedAt: new Date(),
          },
        });
      }
      return { count: allowedIds.length, heldCount };
    }

    const fields = this.piiAnonymizeFields[modelName] || [];
    if (fields.length === 0) return { count: 0, heldCount };

    for (const record of records.filter((record) => allowedIds.includes(record.id))) {
      const updateData: Record<string, string> = {};
      for (const field of fields) {
        updateData[field] =
          field === "email"
            ? `[redacted-${record.id}]@erased.local`
            : "[redacted]";
      }
      await model.update!({ where: { id: record.id }, data: updateData });
    }
    return { count: allowedIds.length, heldCount };
  }

  /* ── Retention Policies ─────────────────────────────── */

  async getRetentionPolicies(tenantId: string) {
    return prisma.dataRetentionPolicy.findMany({
      where: { tenantId },
      orderBy: { entityType: "asc" },
    });
  }

  async upsertRetentionPolicy(
    tenantId: string,
    data: {
      entityType: string;
      retentionDays: number;
      action: string;
      isActive: boolean;
    },
  ) {
    return prisma.dataRetentionPolicy.upsert({
      where: { tenantId_entityType: { tenantId, entityType: data.entityType } },
      update: {
        retentionDays: data.retentionDays,
        action: data.action,
        isActive: data.isActive,
      },
      create: {
        tenantId,
        entityType: data.entityType,
        retentionDays: data.retentionDays,
        action: data.action,
        isActive: data.isActive,
      },
    });
  }

  /* ── Erasure Requests ───────────────────────────────── */

  async getErasureRequests(tenantId: string) {
    return prisma.dataErasureRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createErasureRequest(
    tenantId: string,
    requestedBy: string,
    data: { subjectEmail: string; subjectName?: string; entityTypes: string[] },
  ) {
    return prisma.dataErasureRequest.create({
      data: {
        tenantId,
        requestedBy,
        subjectEmail: data.subjectEmail,
        subjectName: data.subjectName,
        entityTypes: data.entityTypes,
        status: "PENDING",
      },
    });
  }

  async executeErasure(tenantId: string, requestId: string) {
    return runWithTenantSession(
      { tenantId, userId: "privacy-operations" },
      async () => {
        const request = await prisma.dataErasureRequest.findFirst({
          where: { id: requestId, tenantId },
        });
        if (!request) throw new NotFoundException("Erasure request not found");
        if (["COMPLETED", "COMPLETED_WITH_RETENTIONS"].includes(request.status)) {
          throw new BadRequestException("Already executed");
        }
        if (["CANCELLED", "PROCESSING"].includes(request.status)) {
          throw new BadRequestException(`Request cannot execute from ${request.status} state`);
        }
        if (request.eligibleAt && request.eligibleAt.getTime() > Date.now()) {
          throw new BadRequestException("The account-deletion cooling-off period has not ended.");
        }

        await prisma.dataErasureRequest.update({
          where: { id: requestId },
          data: {
            status: "PROCESSING",
            executionStartedAt: new Date(),
            executionAttempts: { increment: 1 },
            executionError: null,
            legalHoldReason: null,
          },
        });

        try {
          const entityTypes = (request.entityTypes as string[]) || [];
          const email = request.subjectEmail;
          const registry = this.loadPiiRegistry();
          const results: ErasureResult[] = [];

          for (const et of entityTypes) {
            const modelName = this.resolveModelName(et);
            if (!modelName) {
              throw new BadRequestException(`Unrecognized erasure entity type "${et}".`);
            }
            const entry = registry.models[modelName];
            if (!entry) {
              throw new BadRequestException(`No reviewed PII treatment exists for "${modelName}".`);
            }
            switch (entry.treatment) {
              case "erase": {
                const outcome = await this.eraseRecords(modelName, tenantId, email);
                results.push({
                  entityType: modelName,
                  treatment: outcome.heldCount ? "erased-with-legal-hold" : "erased",
                  count: outcome.count,
                  heldCount: outcome.heldCount || undefined,
                });
                break;
              }
              case "anonymize": {
                const outcome = await this.anonymizeRecords(modelName, tenantId, email);
                results.push({
                  entityType: modelName,
                  treatment: outcome.heldCount ? "anonymized-with-legal-hold" : "anonymized",
                  count: outcome.count,
                  heldCount: outcome.heldCount || undefined,
                });
                break;
              }
              case "retain-legal-hold": {
                this.logger.log(`SKIP "${modelName}": retain-legal-hold (${entry.rationale})`);
                results.push({
                  entityType: modelName,
                  treatment: "retained-legal-hold",
                  count: 0,
                  heldCount: 1,
                });
                break;
              }
            }
          }

          const hasRetentions = results.some((result) => (result.heldCount || 0) > 0);

          // D11/G-3 — encrypt the subject reference before the immutable audit
          // write, then destroy its only key after the audit transaction.
          const encryptedEmailRef = await this.cryptoShred.encryptForAudit(tenantId, email, email);
          await prisma.auditLog.create({
            data: {
              tenantId,
              userId: request.requestedBy,
              action: "GDPR_ERASURE",
              entityType: "GDPR",
              entityId: requestId,
              changes: {
                subjectEmailRef: encryptedEmailRef,
                results,
                executedAt: new Date().toISOString(),
              } as never,
            },
          });
          await this.cryptoShred.shred(tenantId, email);
          await prisma.dataErasureRequest.update({
            where: { id: requestId },
            data: {
              status: hasRetentions ? "COMPLETED_WITH_RETENTIONS" : "COMPLETED",
              legalHoldReason: hasRetentions
                ? "One or more records remain under an active or policy-mandated legal hold."
                : null,
              erasedAt: new Date(),
            },
          });
          return { results, retainedUnderLegalHold: hasRetentions };
        } catch (error) {
          await prisma.dataErasureRequest.update({
            where: { id: requestId },
            data: {
              status: "FAILED",
              executionError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown privacy operation failure",
            },
          });
          throw error;
        }
      },
    );
  }

  /* ── Data Export (Right of Access) ──────────────────── */

  async exportSubjectData(tenantId: string, email: string) {
    const [customers, contacts, leads, employees, vendors] = await Promise.all([
      prisma.customer.findMany({ where: { tenantId, email } }),
      prisma.contact.findMany({ where: { tenantId, email } }),
      prisma.lead.findMany({ where: { tenantId, email } }),
      prisma.employee.findMany({ where: { tenantId, email } }),
      prisma.vendor.findMany({ where: { tenantId, email } }),
    ]);
    return { customers, contacts, leads, employees, vendors };
  }

  /* ── Platform Compliance (reports / certifications / DPA / audit trail) ── */
  /* Mirrors the stateless/stubbed shape of the legacy saas/compliance.controller.ts
     reports & certifications — no dedicated Prisma models exist for these yet.
     Real audit-trail data is backed by AuditLog (via this service's own methods). */

  listComplianceReports() {
    return [
      {
        id: "1",
        type: "soc2",
        status: "compliant",
        generatedAt: "2024-01-15",
        expiresAt: "2025-01-15",
      },
      {
        id: "2",
        type: "gdpr",
        status: "compliant",
        generatedAt: "2024-02-01",
        expiresAt: "2025-02-01",
      },
    ];
  }

  generateComplianceReport(type: string) {
    return {
      success: true,
      type,
      status: "generating",
      estimatedCompletion: new Date(Date.now() + 60000),
    };
  }

  getComplianceReport(id: string) {
    return {
      id,
      type: "soc2",
      status: "compliant",
      findings: [],
      generatedAt: "2024-01-15",
    };
  }

  listCertifications() {
    return [
      {
        standard: "SOC 2 Type II",
        status: "certified",
        certifiedAt: "2024-01-01",
        expiresAt: "2025-01-01",
      },
      {
        standard: "GDPR",
        status: "compliant",
        certifiedAt: "2024-02-01",
        expiresAt: null,
      },
      {
        standard: "HIPAA",
        status: "in_progress",
        certifiedAt: null,
        expiresAt: null,
      },
    ];
  }

  requestCertification(standard: string) {
    return {
      success: true,
      standard,
      status: "requested",
      requestedAt: new Date(),
    };
  }

  getDataProcessingAgreement() {
    return {
      signed: false,
      version: "2.1",
      content: "Data Processing Agreement content...",
      signedAt: null,
      signedBy: null,
    };
  }

  signDataProcessingAgreement(acceptedBy: string) {
    return { success: true, signedAt: new Date(), signedBy: acceptedBy };
  }

  getHipaaStatus() {
    return {
      compliant: true,
      lastAssessment: "2024-03-01",
      nextAssessment: "2024-09-01",
      controls: 120,
      passed: 118,
    };
  }

  async getGdprStatus(tenantId: string) {
    const [dataExports, erasureRequests] = await Promise.all([
      prisma.dataErasureRequest.count({ where: { tenantId } }).catch(() => 0),
      prisma.dataErasureRequest
        .count({ where: { tenantId, status: "PENDING" } })
        .catch(() => 0),
    ]);
    return {
      compliant: true,
      dpaSigned: false,
      dataExports,
      erasureRequests,
      dataProcessor: "AWS (Frankfurt)",
    };
  }

  listComplianceStandards() {
    return [
      { id: "soc2", name: "SOC 2 Type II", status: "certified" },
      { id: "hipaa", name: "HIPAA", status: "in_progress" },
      { id: "gdpr", name: "GDPR", status: "compliant" },
      { id: "iso27001", name: "ISO 27001", status: "not_started" },
      { id: "pci", name: "PCI DSS", status: "not_applicable" },
    ];
  }

  runComplianceScan() {
    return {
      success: true,
      status: "scanning",
      findings: [],
      startedAt: new Date(),
    };
  }
}
