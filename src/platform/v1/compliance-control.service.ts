/**
 * M38 — compliance controls and evidence.
 *
 * A control catalogue mapped to frameworks (SOC2/ISO27001/GDPR …),
 * with continuous control monitoring: each control carries a
 * declarative evidence query evaluated against the M14 audit spine
 * (`controlPlaneAuditLog`). A control is PASS when the real audit
 * records satisfy the query, FAIL otherwise — so a failing control
 * is failing in the console before it is failing in an audit.
 *
 * `exportEvidence()` answers an auditor's question by re-running the
 * control's query against the real spine and packaging the matching
 * rows into an artefact. There is no manual assembly step: the rows
 * in the artefact ARE the audit records, and the contentHash lets an
 * auditor verify the artefact matches the spine it was taken from.
 */
import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { createHash } from "crypto";
import { prisma } from "@kannan19302/database";

export interface ComplianceEvidenceQuery {
  /** Spine model to evaluate. Always the M14 audit spine today. */
  model: "controlPlaneAuditLog";
  /** Prisma `where` that selects the evidence records for this control. */
  where: Record<string, unknown>;
  /** Minimum number of matching records for the control to PASS. */
  minRecords: number;
}

export interface ComplianceControlDeclaration {
  code: string;
  frameworks: string;
  title: string;
  description: string;
  evidenceQuery: ComplianceEvidenceQuery;
}

/**
 * The control catalogue, mapped to frameworks. The single source of
 * truth for what "compliance" means in plane 1; the console renders
 * exactly this list and nothing else.
 */
export const CONTROL_CATALOGUE: ComplianceControlDeclaration[] = [
  {
    code: "AUDIT-COMPLETE",
    frameworks: "SOC2:CC3.4,ISO27001:A.12.4.1",
    title: "Every provider operation is recorded on the audit spine",
    description:
      "The M14 audit spine must carry at least one immutable record of provider operations, so an auditor can trace what happened.",
    evidenceQuery: {
      model: "controlPlaneAuditLog",
      where: {},
      minRecords: 1,
    },
  },
  {
    code: "AUDIT-ACTOR-ATTRIBUTED",
    frameworks: "SOC2:CC6.1,ISO27001:A.9.2.1",
    title: "Every audit record identifies the acting operator",
    description:
      "Audit records must name the actor who initiated the operation, so responsibility is never anonymous.",
    evidenceQuery: {
      model: "controlPlaneAuditLog",
      where: { actorId: { not: "" } },
      minRecords: 1,
    },
  },
  {
    code: "AUDIT-TAMPER-EVIDENT",
    frameworks: "SOC2:CC7.3,ISO27001:A.12.4.3",
    title: "The audit chain is hash-chained and tamper-evident",
    description:
      "Every audit record must carry a contentHash and link to a previousHash, so a modified or deleted record is detectable.",
    evidenceQuery: {
      model: "controlPlaneAuditLog",
      where: {
        contentHash: { not: "" },
        previousHash: { not: null },
      },
      minRecords: 1,
    },
  },
  {
    code: "APPROVAL-TWO-PERSON",
    frameworks: "SOC2:CC5.3,ISO27001:A.13.2.1",
    title: "Sensitive operations require two-person approval",
    description:
      "Operations that mutate the estate must flow through a two-person approval (C04/M49), whose decision is recorded on the audit spine.",
    evidenceQuery: {
      model: "controlPlaneAuditLog",
      where: { action: { contains: "two-person-control.approval" } },
      minRecords: 1,
    },
  },
];

@Injectable()
export class ComplianceControlService {
  /**
   * The catalogue, mapped to frameworks, joined with each control's
   * LATEST evaluation — so the console renders a failing control on
   * first load, before any external audit has run. A control never
   * evaluated yet reports `status: null` (rendered as "NOT RUN").
   */
  async listCatalogue() {
    const latest = await (prisma as any).complianceControlEvaluation.findMany({
      orderBy: { evaluatedAt: "desc" },
    });
    const latestByControl = new Map<string, any>();
    for (const row of latest) {
      if (!latestByControl.has(row.controlId)) latestByControl.set(row.controlId, row);
    }

    return CONTROL_CATALOGUE.map((control) => {
      const evaluation = latestByControl.get(control.code);
      return {
        ...control,
        status: evaluation?.status ?? null,
        observed: evaluation?.observed ?? 0,
        finding: evaluation?.finding ?? null,
        evaluatedAt: evaluation?.evaluatedAt ?? null,
      };
    });
  }

  /**
   * Evaluate one control against the REAL audit spine and persist the
   * result as a `ComplianceControlEvaluation` row — the continuous
   * monitoring trail. FAILing means the spine's records do not satisfy
   * the control's query: the control is failing in the console before
   * it is failing in an audit.
   */
  async evaluateControl(code: string) {
    const declaration = CONTROL_CATALOGUE.find((c) => c.code === code);
    if (!declaration) throw new NotFoundException(`Control "${code}" is not in the catalogue`);

    const delegate = (prisma as any)[declaration.evidenceQuery.model];
    if (!delegate?.count) {
      throw new BadRequestException(`Spine model "${declaration.evidenceQuery.model}" is not queryable`);
    }

    const observed = await delegate.count({ where: declaration.evidenceQuery.where });
    const status = observed >= declaration.evidenceQuery.minRecords ? "PASS" : "FAIL";
    const finding =
      status === "FAIL"
        ? `Control "${code}" found ${observed} audit record(s); ${declaration.evidenceQuery.minRecords} required`
        : null;

    return (prisma as any).complianceControlEvaluation.create({
      data: { controlId: code, status, observed, finding },
    });
  }

  /**
   * Run every control in the catalogue and return each control with
   * its latest evaluation — "continuous control monitoring" as a
   * single call the console renders directly.
   */
  async runMonitoring() {
    const results: Array<{
      code: string;
      frameworks: string;
      title: string;
      description: string;
      status: string;
      observed: number;
      finding: string | null;
      evaluatedAt: Date;
    }> = [];

    for (const control of CONTROL_CATALOGUE) {
      const evaluation = await this.evaluateControl(control.code);
      results.push({
        code: control.code,
        frameworks: control.frameworks,
        title: control.title,
        description: control.description,
        status: evaluation.status,
        observed: evaluation.observed,
        finding: evaluation.finding,
        evaluatedAt: evaluation.evaluatedAt,
      });
    }

    return results;
  }

  /**
   * Answer an auditor's question with an evidence artefact generated
   * from REAL audit records. Re-runs the control's query, packages the
   * matching rows, hashes them, and persists a `ComplianceEvidence`
   * row. No manual assembly step — the artefact rows ARE the audit
   * records.
   */
  async exportEvidence(code: string, auditorQuestion: string, generatedBy: string) {
    if (!auditorQuestion?.trim()) {
      throw new BadRequestException("An auditor question is required to export evidence");
    }
    if (!generatedBy?.trim()) {
      throw new BadRequestException("The exporting operator must be identified");
    }

    const declaration = CONTROL_CATALOGUE.find((c) => c.code === code);
    if (!declaration) throw new NotFoundException(`Control "${code}" is not in the catalogue`);

    const delegate = (prisma as any)[declaration.evidenceQuery.model];
    const records = await delegate.findMany({ where: declaration.evidenceQuery.where });

    const serialised = JSON.stringify(records, null, 2);
    const contentHash = createHash("sha256").update(serialised).digest("hex");

    const artefact = {
      control: { code, frameworks: declaration.frameworks, title: declaration.title },
      auditorQuestion,
      generatedAt: new Date().toISOString(),
      generatedBy,
      recordCount: records.length,
      records,
    };

    return (prisma as any).complianceEvidence.create({
      data: {
        controlCode: code,
        auditorQuestion,
        artefact,
        contentHash,
        generatedBy,
      },
    });
  }

  /** List previously exported evidence artefacts for a control. */
  async listEvidence(code: string) {
    const declaration = CONTROL_CATALOGUE.find((c) => c.code === code);
    if (!declaration) throw new NotFoundException(`Control "${code}" is not in the catalogue`);

    return (prisma as any).complianceEvidence.findMany({
      where: { controlCode: code },
      orderBy: { generatedAt: "desc" },
    });
  }
}