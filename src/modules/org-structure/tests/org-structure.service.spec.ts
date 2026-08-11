/**
 * D04 — basic coverage for org unit/position CRUD, tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let orgUnits: any[];
let orgPositions: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    orgUnit: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("unit"), createdAt: new Date(), ...data }; orgUnits.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => orgUnits.filter((u) => u.tenantId === where.tenantId)),
    },
    orgPosition: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("pos"), createdAt: new Date(), ...data }; orgPositions.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => orgPositions.filter((p) => p.tenantId === where.tenantId)),
    },
  },
}));

import { OrgStructureService } from "../org-structure.service";

describe("D04 · org units and positions, tenant-scoped", () => {
  let orgStructure: OrgStructureService;

  beforeEach(() => {
    vi.clearAllMocks();
    orgUnits = [];
    orgPositions = [];
    orgStructure = new OrgStructureService();
  });

  it("creates an org unit of a valid kind", async () => {
    const unit = await orgStructure.createOrgUnit("t1", { name: "Acme Corp", kind: "LEGAL_ENTITY" });
    expect(unit.kind).toBe("LEGAL_ENTITY");
  });

  it("refuses an unknown org unit kind", async () => {
    await expect(orgStructure.createOrgUnit("t1", { name: "X", kind: "NOT_A_KIND" })).rejects.toThrow(/Unknown org unit kind/);
  });

  it("lists org units scoped strictly to the calling tenant", async () => {
    await orgStructure.createOrgUnit("t1", { name: "A", kind: "TEAM" });
    await orgStructure.createOrgUnit("t2", { name: "B", kind: "TEAM" });

    const t1Units = await orgStructure.listOrgUnits("t1");
    expect(t1Units).toHaveLength(1);
    expect(t1Units[0]!.tenantId).toBe("t1");
  });

  it("creates a position, optionally vacant (no occupant)", async () => {
    const unit = await orgStructure.createOrgUnit("t1", { name: "Eng", kind: "TEAM" });
    const position = await orgStructure.createPosition("t1", { orgUnitId: unit.id, title: "Manager" });
    expect(position.occupantUserId).toBeNull();
  });
});
