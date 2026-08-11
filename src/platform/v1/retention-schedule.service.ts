/**
 * M37 — retention enforcement for Track M's own data, executing on the
 * IDENTICAL declaration `unierp-workspace/scripts/retention-matrix.json`
 * (C24's own source of truth, enforced there by `enforce-retention.mjs`)
 * carries for this dataClass — never a second, divergent schedule.
 * `retention-schedule.consistency.spec.ts` reads that file directly and
 * asserts this constant matches it field-for-field.
 */
import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface RetentionClassDeclaration {
  dataClass: string;
  model: string;
  timestampField: string;
  retentionDays: number;
}

/** Must match `unierp-workspace/scripts/retention-matrix.json`'s
 *  "provider-telemetry-samples" entry exactly — see the consistency spec. */
export const TRACK_M_RETENTION_CLASSES: RetentionClassDeclaration[] = [
  { dataClass: "provider-telemetry-samples", model: "telemetrySample", timestampField: "observedAt", retentionDays: 90 },
];

@Injectable()
export class RetentionScheduleService {
  /**
   * "A retention schedule executes deletion on time and certifies it":
   * deletes only records past `retentionDays` (the cutoff), and ALWAYS
   * writes a RetentionCertificate — even when zero candidates existed —
   * so "it ran" is provable independent of whether anything was found.
   */
  async executeAndCertify(dataClass: string, now: Date = new Date()) {
    const declaration = TRACK_M_RETENTION_CLASSES.find((c) => c.dataClass === dataClass);
    if (!declaration) {
      throw new Error(`No retention class "${dataClass}" declared for Track M`);
    }

    const cutoff = new Date(now.getTime() - declaration.retentionDays * 24 * 60 * 60 * 1000);
    const where = { [declaration.timestampField]: { lt: cutoff } };

    const delegate = (prisma as any)[declaration.model];
    const candidateCount = await delegate.count({ where });
    const deletedCount = candidateCount > 0 ? (await delegate.deleteMany({ where })).count : 0;

    return (prisma as any).retentionCertificate.create({
      data: { dataClass, cutoff, candidateCount, deletedCount },
    });
  }
}
