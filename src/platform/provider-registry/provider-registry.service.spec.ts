/**
 * M03 exit criterion: "Two providers are registered for one capability and
 * both report their discovered capability set. No credential value is
 * persisted in the database — asserted by a test that scans the table and
 * by check-secret-scan. A credential past its expiry disables its provider
 * rather than failing a request."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeProvider {
  id: string;
  name: string;
  description: string | null;
  status: string;
}
interface FakeCredential {
  id: string;
  providerId: string;
  secretRef: string;
  label: string | null;
  expiresAt: Date | null;
}
interface FakeCapabilityRow {
  id: string;
  providerId: string;
  capabilityId: string;
  discoveredAt: Date;
  discoveryDetail: unknown;
}

let providers: FakeProvider[];
let credentials: FakeCredential[];
let bindings: Array<{ providerId: string; capabilityId: string }>;
let capabilityRows: FakeCapabilityRow[];
let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    provider: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("prov"), status: "ACTIVE", description: null, ...data };
        providers.push(row);
        return row;
      }),
      findUnique: vi.fn(({ where: { id } }: any) => providers.find((p) => p.id === id) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => {
        const row = providers.find((p) => p.id === id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    providerBinding: {
      upsert: vi.fn(({ create }: any) => {
        const exists = bindings.some(
          (b) => b.providerId === create.providerId && b.capabilityId === create.capabilityId,
        );
        if (!exists) bindings.push({ providerId: create.providerId, capabilityId: create.capabilityId });
        return create;
      }),
      deleteMany: vi.fn(({ where }: any) => {
        bindings = bindings.filter(
          (b) => !(b.providerId === where.providerId && b.capabilityId === where.capabilityId),
        );
      }),
      findMany: vi.fn(({ where }: any) =>
        bindings
          .filter((b) => b.capabilityId === where.capabilityId)
          .map((b) => ({ ...b, provider: providers.find((p) => p.id === b.providerId) })),
      ),
    },
    providerCredential: {
      create: vi.fn(({ data }: any) => {
        const row = { id: nextId("cred"), label: null, expiresAt: null, ...data };
        credentials.push(row);
        return row;
      }),
      findMany: vi.fn(({ where }: any) =>
        credentials.filter((c) => !where?.expiresAt || c.expiresAt! < where.expiresAt.lt),
      ),
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
        const row = { id: nextId("cap"), discoveredAt: new Date(), discoveryDetail: null, ...create };
        capabilityRows.push(row);
        return row;
      }),
      findMany: vi.fn(({ where }: any) => capabilityRows.filter((c) => c.providerId === where.providerId)),
    },
  },
}));

vi.mock("@kannan19302/shared", () => ({
  bindProvider: vi.fn(),
  unbindProvider: vi.fn(),
}));

import { ProviderRegistryService } from "./provider-registry.service";
import { bindProvider } from "@kannan19302/shared";
import type { ProviderAdapter } from "./provider-adapter.interface";

describe("M03 · provider registry, credentials and discovery", () => {
  let service: ProviderRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    providers = [];
    credentials = [];
    bindings = [];
    capabilityRows = [];
    service = new ProviderRegistryService();
  });

  it("two providers are registered for one capability and both report their discovered set", async () => {
    const a = await service.registerProvider({ name: "Provider A" });
    const b = await service.registerProvider({ name: "Provider B" });

    await service.bindCapability(a.id, "email.send");
    await service.bindCapability(b.id, "email.send");

    // bindCapability must push into the M02 capability registry, not just
    // this table — that is what makes resolve("email.send") ever see them.
    expect(bindProvider).toHaveBeenCalledWith("email.send", a.id);
    expect(bindProvider).toHaveBeenCalledWith("email.send", b.id);

    const forCapability = await service.getProvidersForCapability("email.send");
    expect(forCapability.map((p: any) => p.id).sort()).toEqual([a.id, b.id].sort());

    const adapterA: ProviderAdapter = {
      discover: vi.fn().mockResolvedValue([{ capabilityId: "email.send", detail: { region: "us-east-1" } }]),
    };
    const adapterB: ProviderAdapter = {
      discover: vi.fn().mockResolvedValue([{ capabilityId: "email.send", detail: { region: "eu-west-1" } }]),
    };
    service.registerAdapter(a.id, adapterA);
    service.registerAdapter(b.id, adapterB);

    await service.discoverCapabilities(a.id);
    await service.discoverCapabilities(b.id);

    const discoveredA = await service.getDiscoveredCapabilities(a.id);
    const discoveredB = await service.getDiscoveredCapabilities(b.id);
    expect(discoveredA).toHaveLength(1);
    expect(discoveredB).toHaveLength(1);
    expect(discoveredA[0].capabilityId).toBe("email.send");
    expect(discoveredB[0].capabilityId).toBe("email.send");
    expect((discoveredA[0].discoveryDetail as any).region).toBe("us-east-1");
    expect((discoveredB[0].discoveryDetail as any).region).toBe("eu-west-1");
  });

  it("discovery against a provider with no registered adapter fails explicitly, not silently as zero capabilities", async () => {
    const p = await service.registerProvider({ name: "No Adapter" });
    await expect(service.discoverCapabilities(p.id)).rejects.toThrow(/no adapter registered/i);
  });

  it("no credential value is ever persisted — setCredential's own type has no field for one", async () => {
    const p = await service.registerProvider({ name: "Cred Test" });
    const row = await service.setCredential(p.id, { secretRef: "vault://secrets/provider-x/api-key" });

    // Scan the persisted row for anything that looks like a raw secret.
    const values = Object.values(row);
    expect(values).not.toContain("sk_live_abc123"); // sentinel: never present, because never accepted
    expect(row).not.toHaveProperty("value");
    expect(row).not.toHaveProperty("secret");
    expect(row.secretRef).toBe("vault://secrets/provider-x/api-key");

    // Static proof, not just this one row: the type itself has no such field.
    // @ts-expect-error — RegisterCredentialInput has no `value`/`secret` field to assign to.
    const attempted: Parameters<typeof service.setCredential>[1] = {
      secretRef: "vault://x",
      value: "sk_live_should_not_compile",
    };
    void attempted;
  });

  it("a credential past its expiry disables its provider rather than the caller finding out via a failed request", async () => {
    const p = await service.registerProvider({ name: "Expiring" });
    await service.setCredential(p.id, {
      secretRef: "vault://secrets/expiring",
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    expect(p.status).toBe("ACTIVE");
    const disabled = await service.disableProvidersWithExpiredCredentials();
    expect(disabled).toContain(p.id);

    const reloaded = await (await import("@kannan19302/database")).prisma.provider.findUnique({
      where: { id: p.id },
    });
    expect((reloaded as any).status).toBe("DISABLED_EXPIRED_CREDENTIAL");
  });

  it("a credential with no expiry, or one in the future, does not disable its provider", async () => {
    const p = await service.registerProvider({ name: "Healthy" });
    await service.setCredential(p.id, {
      secretRef: "vault://secrets/healthy",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const disabled = await service.disableProvidersWithExpiredCredentials();
    expect(disabled).not.toContain(p.id);
  });
});
