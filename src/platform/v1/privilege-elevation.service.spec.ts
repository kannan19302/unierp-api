/**
 * M32 exit criterion (elevation half): "An elevated privilege expires
 * automatically and is audited on both grant and expiry."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let elevations: any[];
let auditLogs: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    privilegeElevation: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("elev"), expiredAuditedAt: null, ...data };
        elevations.push(row);
        return row;
      }),
      findFirst: vi.fn(({ where }: any) =>
        elevations
          .filter((e) => e.userId === where.userId && e.privilege === where.privilege)
          .sort((a, b) => new Date(b.grantedAt).getTime() - new Date(a.grantedAt).getTime())[0] ?? null,
      ),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = elevations.find((e) => e.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    controlPlaneAuditLog: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("audit"), ...data };
        auditLogs.push(row);
        return row;
      }),
    },
  },
}));

import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { PrivilegeElevationService } from "./privilege-elevation.service";

describe("M32 · just-in-time privilege elevation", () => {
  let elevation: PrivilegeElevationService;

  beforeEach(() => {
    vi.clearAllMocks();
    elevations = [];
    auditLogs = [];
    elevation = new PrivilegeElevationService(new ControlPlaneAuditService());
  });

  it("granting an elevation is AUDITED ON GRANT", async () => {
    await elevation.grant("op-1", "system.release.rollback", "op-approver", 60_000);
    const grants = auditLogs.filter((a) => a.action === "privilege.elevation-granted");
    expect(grants).toHaveLength(1);
    expect(grants[0].targetId).toBe("op-1");
    expect(grants[0].details.privilege).toBe("system.release.rollback");
  });

  it("an active (unexpired) elevation reports isElevated true, with no expiry audit", async () => {
    await elevation.grant("op-1", "system.release.rollback", "op-approver", 60_000);
    const active = await elevation.isElevated("op-1", "system.release.rollback", new Date(Date.now() + 30_000));
    expect(active).toBe(true);
    expect(auditLogs.filter((a) => a.action === "privilege.elevation-expired")).toHaveLength(0);
  });

  it("an elevated privilege EXPIRES AUTOMATICALLY and is AUDITED ON EXPIRY", async () => {
    await elevation.grant("op-1", "system.release.rollback", "op-approver", 60_000);

    // Check well past the 60s TTL.
    const afterExpiry = new Date(Date.now() + 120_000);
    const stillActive = await elevation.isElevated("op-1", "system.release.rollback", afterExpiry);

    expect(stillActive).toBe(false); // expired automatically -- no manual revocation needed
    const expiries = auditLogs.filter((a) => a.action === "privilege.elevation-expired");
    expect(expiries).toHaveLength(1);
    expect(expiries[0].targetId).toBe("op-1");
  });

  it("the expiry audit fires exactly ONCE per grant, not on every subsequent check", async () => {
    await elevation.grant("op-1", "system.release.rollback", "op-approver", 60_000);
    const afterExpiry = new Date(Date.now() + 120_000);

    await elevation.isElevated("op-1", "system.release.rollback", afterExpiry);
    await elevation.isElevated("op-1", "system.release.rollback", afterExpiry);
    await elevation.isElevated("op-1", "system.release.rollback", afterExpiry);

    const expiries = auditLogs.filter((a) => a.action === "privilege.elevation-expired");
    expect(expiries).toHaveLength(1);
  });

  it("a user with no elevation at all is never elevated", async () => {
    const active = await elevation.isElevated("op-never-granted", "system.release.rollback");
    expect(active).toBe(false);
  });
});
