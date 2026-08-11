/**
 * M37 exit criterion (consistency half): "...certifies it consistently
 * with DELETION_POLICY.md and C24." This test reads
 * unierp-workspace/scripts/retention-matrix.json DIRECTLY — the actual
 * file `enforce-retention.mjs` (C24's own enforcement script) reads —
 * and asserts TRACK_M_RETENTION_CLASSES matches it field for field. A
 * divergence here means unierp-api's own schedule would delete on a
 * different clock than the one C24 documents and enforces platform-wide.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRACK_M_RETENTION_CLASSES } from "./retention-schedule.service";

describe("M37 · retention schedule is consistent with C24's retention-matrix.json", () => {
  it("every Track M retention class matches its declaration in unierp-workspace/scripts/retention-matrix.json exactly", () => {
    const matrixPath = join(__dirname, "..", "..", "..", "..", "unierp-workspace", "scripts", "retention-matrix.json");
    const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));

    for (const declared of TRACK_M_RETENTION_CLASSES) {
      const canonical = matrix.classes.find((c: any) => c.dataClass === declared.dataClass);
      expect(canonical, `"${declared.dataClass}" must exist in retention-matrix.json`).toBeDefined();
      expect(declared.model).toBe(canonical.model);
      expect(declared.timestampField).toBe(canonical.timestampField);
      expect(declared.retentionDays).toBe(canonical.retentionDays);
    }
  });

  it("every entry in the canonical matrix tagged as Track M's is represented in TRACK_M_RETENTION_CLASSES -- nothing declared there and silently unenforced here", () => {
    const matrixPath = join(__dirname, "..", "..", "..", "..", "unierp-workspace", "scripts", "retention-matrix.json");
    const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));

    const trackMEntries = matrix.classes.filter((c: any) => typeof c.basis === "string" && c.basis.includes("Track M"));
    expect(trackMEntries.length).toBeGreaterThan(0);
    for (const entry of trackMEntries) {
      const enforced = TRACK_M_RETENTION_CLASSES.find((c) => c.dataClass === entry.dataClass);
      expect(enforced, `"${entry.dataClass}" is declared as Track M's in the matrix but not enforced by RetentionScheduleService`).toBeDefined();
    }
  });
});
