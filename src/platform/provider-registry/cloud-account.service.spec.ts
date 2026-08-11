/**
 * M16 exit criterion: "A second cloud account of a different provider is
 * onboarded through the UI and its inventory appears in the estate without
 * a code change. Its credentials are secret-refs (M03)."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let providers: any[];
let credentials: any[];
let capabilityRows: any[];
let kinds: any[];
let resources: any[];
let desiredStates: any[];
let desiredStateVersions: any[];
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    provider: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("prov"), status: "ACTIVE", description: null, ...data };
        providers.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => providers.find((p) => p.id === id) ?? null),
    },
    providerCredential: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("cred"), label: null, expiresAt: null, ...data };
        credentials.push(row);
        return row;
      }),
    },
    providerCapability: {
      upsert: vi.fn(({ where, create, update }: any) => {
        const existing = capabilityRows.find(
          (c) =>
            c.providerId === where.providerId_capabilityId.providerId &&
            c.capabilityId === where.providerId_capabilityId.capabilityId,
        );
        if (existing) {
          Object.assign(existing, update, { discoveredAt: new Date() });
          return existing;
        }
        const row = { id: nextId("cap"), discoveredAt: new Date(), ...create };
        capabilityRows.push(row);
        return row;
      }),
    },
    resourceKind: {
      upsert: vi.fn(({ where: { name }, create }: any) => {
        const existing = kinds.find((k) => k.name === name);
        if (existing) return existing;
        const row = { id: nextId("kind"), ...create };
        kinds.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { name } }: any) => kinds.find((k) => k.name === name) ?? null),
    },
    resource: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("res"), ...data };
        resources.push(row);
        return row;
      }),
      findMany: vi.fn(({ where }: any) => {
        let rows = resources.map((r) => ({ ...r, kind: kinds.find((k) => k.id === r.kindId) }));
        if (where?.kind?.name) rows = rows.filter((r) => r.kind?.name === where.kind.name);
        return rows;
      }),
      count: vi.fn(({ where }: any) => {
        let rows = resources;
        if (where?.kind?.name) rows = rows.filter((r) => kinds.find((k) => k.id === r.kindId)?.name === where.kind.name);
        return rows.length;
      }),
    },
    desiredState: {
      upsert: vi.fn(({ where: { resourceId }, create, update }: any) => {
        const existing = desiredStates.find((d) => d.resourceId === resourceId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: nextId("ds"), ...create };
        desiredStates.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { resourceId } }: any) => desiredStates.find((d) => d.resourceId === resourceId) ?? null),
    },
    desiredStateVersion: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("dsv"), setAt: new Date(), ...data };
        desiredStateVersions.push(row);
        return row;
      }),
    },
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { ProviderRegistryService } from "./provider-registry.service";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { CloudAccountService } from "./cloud-account.service";

describe("M16 · cloud accounts and multi-cloud onboarding", () => {
  let cloudAccounts: CloudAccountService;

  beforeEach(() => {
    vi.clearAllMocks();
    providers = [];
    credentials = [];
    capabilityRows = [];
    kinds = [];
    resources = [];
    desiredStates = [];
    desiredStateVersions = [];
    cloudAccounts = new CloudAccountService(new ProviderRegistryService(), new ResourceModelService());
  });

  it("a second cloud account of a DIFFERENT provider onboards through the exact same code path, with no per-vendor branch", async () => {
    const aws = await cloudAccounts.onboardAccount({
      accountName: "acme-prod-aws",
      providerType: "aws",
      secretRef: "vault://aws/acme-prod",
      inventoryKinds: ["ec2-instance", "s3-bucket"],
    });

    const azure = await cloudAccounts.onboardAccount({
      accountName: "acme-prod-azure",
      providerType: "azure",
      secretRef: "vault://azure/acme-prod",
      inventoryKinds: ["vm", "storage-account", "resource-group"],
    });

    expect(aws.provider.id).not.toBe(azure.provider.id);
    expect(aws.inventoryResources).toHaveLength(2);
    expect(azure.inventoryResources).toHaveLength(3);
  });

  it("its inventory appears in the estate — the same Resource table M15's search reads", async () => {
    await cloudAccounts.onboardAccount({
      accountName: "acme-gcp",
      providerType: "gcp",
      secretRef: "vault://gcp/acme",
      inventoryKinds: ["compute-instance", "gcs-bucket"],
    });

    const resourceModel = new ResourceModelService();
    const inCompute = await resourceModel.searchResources({ kindName: "cloud-account.gcp.compute-instance" });
    expect(inCompute.items).toHaveLength(1);
    expect(inCompute.items[0]!.name).toBe("acme-gcp · compute-instance");

    const accounts = await resourceModel.searchResources({ kindName: "cloud-account" });
    expect(accounts.items.map((it) => it.name)).toEqual(["acme-gcp"]);
  });

  it("credentials are secret-refs — no literal secret value is ever accepted or persisted", async () => {
    await cloudAccounts.onboardAccount({
      accountName: "acme-secret-test",
      providerType: "aws",
      secretRef: "vault://aws/acme-secret-test",
      inventoryKinds: ["ec2-instance"],
    });

    expect(credentials).toHaveLength(1);
    expect(credentials[0].secretRef).toBe("vault://aws/acme-secret-test");
    // The type CloudAccountService.onboardAccount accepts has no `secret`/
    // `value` field at all — this asserts the one persisted row has no such
    // key either, so nothing could have been added ad hoc.
    expect(Object.keys(credentials[0])).not.toContain("secret");
    expect(Object.keys(credentials[0])).not.toContain("value");
  });
});
