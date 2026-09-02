/**
 * D17 exit criterion: "A sensitive setting cannot change without an
 * approver. Any change is revertable to its previous value from the
 * audit record."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let approvals: any[];
let changeHistory: any[];
let seq = 0;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    settingChangeApproval: {
      create: vi.fn(({ data }: any) => { const row = { id: `appr-${++seq}`, createdAt: new Date(), approvedBy: null, decidedAt: null, ...data }; approvals.push(row); return row; }),
      findFirst: vi.fn(({ where }: any) => approvals.find((a) => a.id === where.id && a.tenantId === where.tenantId) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => { const row = approvals.find((a) => a.id === id)!; Object.assign(row, data); return row; }),
    },
    changeHistory: {
      create: vi.fn(({ data }: any) => { const row = { id: `ch-${++seq}`, createdAt: new Date(), ...data }; changeHistory.push(row); return row; }),
      findFirst: vi.fn(({ where }: any) => changeHistory.find((c) => c.id === where.id && c.tenantId === where.tenantId && c.entityType === where.entityType) ?? null),
    },
  },
}));

import { SettingsChangeControlService } from "../services/settings-change-control.service";

describe("D17 · settings audit and change control", () => {
  let changeControl: SettingsChangeControlService;

  beforeEach(() => {
    vi.clearAllMocks();
    approvals = [];
    changeHistory = [];
    seq = 0;
    changeControl = new SettingsChangeControlService();
  });

  it("a NON-sensitive setting applies immediately and writes ChangeHistory with actor/before/after/reason", async () => {
    const result = await changeControl.requestChange("t1", "ui.theme", "light", "dark", "user-a", "Alice", "user preference", false);
    expect(result.applied).toBe(true);
    expect(changeHistory).toHaveLength(1);
    expect(changeHistory[0]!.fieldChanges).toEqual([{ field: "ui.theme", from: "light", to: "dark" }]);
    expect(changeHistory[0]!.userId).toBe("user-a");
  });

  it("A SENSITIVE setting NEVER applies on request — it creates a PENDING approval and writes NO ChangeHistory", async () => {
    const result = await changeControl.requestChange("t1", "security.mfaRequired", false, true, "user-a", "Alice", "tighten security", true);
    expect(result.applied).toBe(false);
    expect(result.approvalId).toBeDefined();
    expect(changeHistory).toHaveLength(0);
    expect(approvals[0]!.status).toBe("PENDING");
  });

  it("REFUSES the SAME actor approving their own sensitive-setting request", async () => {
    const { approvalId } = await changeControl.requestChange("t1", "security.mfaRequired", false, true, "user-a", "Alice", "reason", true);
    await expect(changeControl.approveChange("t1", approvalId!, "user-a", "Alice", false)).rejects.toThrow(/same actor/);
    expect(changeHistory).toHaveLength(0); // still not applied
  });

  it("a DIFFERENT approver applies the sensitive change and it lands in ChangeHistory", async () => {
    const { approvalId } = await changeControl.requestChange("t1", "security.mfaRequired", false, true, "user-a", "Alice", "reason", true);
    const result = await changeControl.approveChange("t1", approvalId!, "user-b", "Bob", false);

    expect(result.applied).toBe(true);
    expect(approvals[0]!.status).toBe("APPROVED");
    expect(approvals[0]!.approvedBy).toBe("user-b");
    expect(changeHistory).toHaveLength(1);
    expect(changeHistory[0]!.fieldChanges).toEqual([{ field: "security.mfaRequired", from: false, to: true }]);
  });

  it("REFUSES approving an already-decided approval twice", async () => {
    const { approvalId } = await changeControl.requestChange("t1", "s.key", 1, 2, "user-a", "Alice", "r", true);
    await changeControl.approveChange("t1", approvalId!, "user-b", "Bob", 1);
    await expect(changeControl.approveChange("t1", approvalId!, "user-c", "Carol", 1)).rejects.toThrow(/not PENDING/);
  });

  it("ANY CHANGE IS REVERTABLE to its previous value FROM THE AUDIT RECORD", async () => {
    const applied = await changeControl.requestChange("t1", "ui.pageSize", 25, 100, "user-a", "Alice", "bulk view", false);

    const reverted = await changeControl.revertChange("t1", applied.changeHistoryId!, "user-b", "Bob");

    expect(reverted.revertedToValue).toBe(25); // the ORIGINAL value, read from the audit record
    expect(changeHistory).toHaveLength(2); // the revert is a NEW entry, not a rewrite of the old one
    expect(changeHistory[1]!.fieldChanges).toEqual([{ field: "ui.pageSize", from: 100, to: 25 }]);
  });

  it("reverting a NON-EXISTENT change history entry is refused, never silently ignored", async () => {
    await expect(changeControl.revertChange("t1", "nope", "user-a", "Alice")).rejects.toThrow(/not found/);
  });
});
