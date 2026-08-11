/**
 * M32 exit criterion (IdP half): "A second IdP is added without code
 * change."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let providers: any[];
let bindings: any[];
let credentials: any[];
let capabilityRows: any[];
let healthChecks: any[];
let circuitStates: any[];
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
    providerBinding: {
      upsert: vi.fn(({ create }: any) => {
        const exists = bindings.some((b) => b.providerId === create.providerId && b.capabilityId === create.capabilityId);
        if (!exists) bindings.push({ providerId: create.providerId, capabilityId: create.capabilityId, priority: 100 });
        return create;
      }),
      findMany: vi.fn(({ where }: any) => bindings.filter((b) => b.capabilityId === where.capabilityId)),
    },
    providerCredential: { create: vi.fn(({ data }: any) => { const row = { id: nextId("cred"), ...data }; credentials.push(row); return row; }) },
    providerCapability: {
      upsert: vi.fn(({ create }: any) => { const row = { id: nextId("cap"), discoveredAt: new Date(), ...create }; capabilityRows.push(row); return row; }),
    },
    providerHealthConfig: { findUnique: vi.fn(() => null) },
    providerHealthCheck: {
      findFirst: vi.fn(({ where }: any) => healthChecks.filter((h) => h.providerId === where.providerId).sort((a, b) => b.checkedAt - a.checkedAt)[0] ?? null),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("hc"), checkedAt: new Date(), ...data }; healthChecks.push(row); return row; }),
    },
    providerCircuitState: { findUnique: vi.fn(({ where: { providerId } }: any) => circuitStates.find((c) => c.providerId === providerId) ?? null) },
    tenantProviderOverride: { findUnique: vi.fn(() => null) },
    stickyRouteAssignment: { findUnique: vi.fn(() => null), upsert: vi.fn(({ create }: any) => create) },
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { RoutingService } from "../provider-registry/routing.service";
import { StaffIdpService } from "./staff-idp.service";
import { SamlStaffIdpAdapter } from "../provider-registry/adapters/saml-staff-idp.adapter";
import { OidcStaffIdpAdapter } from "../provider-registry/adapters/oidc-staff-idp.adapter";

describe("M32 · multi-provider staff IdP", () => {
  let providersSvc: ProviderRegistryService;
  let idp: StaffIdpService;

  beforeEach(() => {
    vi.clearAllMocks();
    providers = [];
    bindings = [];
    credentials = [];
    capabilityRows = [];
    healthChecks = [];
    circuitStates = [];
    providersSvc = new ProviderRegistryService();
    idp = new StaffIdpService(providersSvc, new RoutingService(providersSvc));
  });

  it("staff authenticate via the SAML IdP when it is the only one registered", async () => {
    const provider = await idp.registerIdpProvider("okta-saml", new SamlStaffIdpAdapter("will-be-set"));
    const adapter = new SamlStaffIdpAdapter(provider.id);
    providersSvc.registerAdapter(provider.id, adapter);
    await providersSvc.recordHealthCheck(provider.id, { healthy: true });

    const result = await idp.authenticateStaff("op-1", "alice@corp.example");
    expect(result.providerId).toBe(provider.id);
    expect(adapter.authenticated).toEqual([{ nameId: "alice@corp.example", sessionId: "saml-session-1" }]);
  });

  it("A SECOND IdP is added without code change: the same authenticateStaff() call succeeds via OIDC when it is the only one registered instead", async () => {
    const provider = await idp.registerIdpProvider("azure-ad-oidc", new OidcStaffIdpAdapter("will-be-set"));
    const adapter = new OidcStaffIdpAdapter(provider.id);
    providersSvc.registerAdapter(provider.id, adapter);
    await providersSvc.recordHealthCheck(provider.id, { healthy: true });

    const result = await idp.authenticateStaff("op-1", "bob@corp.example");
    expect(result.providerId).toBe(provider.id);
    expect(adapter.issuedTokens).toEqual([{ subject: "bob@corp.example", accessToken: "oidc-token-1" }]);
  });

  it("with BOTH registered, priority + circuit-breaker failover moves auth to the other IdP -- still no code change", async () => {
    const saml = await idp.registerIdpProvider("primary-saml", new SamlStaffIdpAdapter("will-be-set"));
    const samlAdapter = new SamlStaffIdpAdapter(saml.id);
    providersSvc.registerAdapter(saml.id, samlAdapter);
    await providersSvc.recordHealthCheck(saml.id, { healthy: true });

    const oidc = await idp.registerIdpProvider("secondary-oidc", new OidcStaffIdpAdapter("will-be-set"));
    const oidcAdapter = new OidcStaffIdpAdapter(oidc.id);
    providersSvc.registerAdapter(oidc.id, oidcAdapter);
    await providersSvc.recordHealthCheck(oidc.id, { healthy: true });
    bindings.find((b) => b.providerId === oidc.id)!.priority = 200;

    const first = await idp.authenticateStaff("op-x", "carol@corp.example");
    expect(first.providerId).toBe(saml.id);

    circuitStates.push({ providerId: saml.id, state: "OPEN", openedAt: new Date(), failureCount: 999 });

    const second = await idp.authenticateStaff("op-y", "dave@corp.example");
    expect(second.providerId).toBe(oidc.id);
  });
});
