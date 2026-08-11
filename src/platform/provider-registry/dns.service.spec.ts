/**
 * M22 exit criterion: "A DNS zone is served by either registered provider
 * without a code change. C26's custom-domain provisioning calls this
 * surface — proven by a test that removes the second implementation and
 * C26 still passes."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let providers: any[];
let bindings: any[];
let credentials: any[];
let capabilityRows: any[];
let overrides: any[];
let stickyAssignments: any[];
let circuitStates: any[];
let priceEntries: any[];
let healthConfigs: any[];
let healthChecks: any[];
let whiteLabelDomains: any[];
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
      findMany: vi.fn(({ where, orderBy }: any) => {
        let rows = bindings.filter((b) => b.capabilityId === where.capabilityId);
        if (orderBy?.priority === "asc") rows = [...rows].sort((a, b) => a.priority - b.priority);
        return rows;
      }),
    },
    providerCredential: { create: vi.fn(({ data }: any) => { const row = { id: nextId("cred"), ...data }; credentials.push(row); return row; }) },
    providerCapability: {
      upsert: vi.fn(({ create }: any) => { const row = { id: nextId("cap"), discoveredAt: new Date(), ...create }; capabilityRows.push(row); return row; }),
    },
    providerHealthConfig: { findUnique: vi.fn(({ where: { providerId } }: any) => healthConfigs.find((h) => h.providerId === providerId) ?? null) },
    providerHealthCheck: {
      findFirst: vi.fn(({ where }: any) => healthChecks.filter((h) => h.providerId === where.providerId).sort((a, b) => b.checkedAt - a.checkedAt)[0] ?? null),
      create: vi.fn(({ data }: any) => { const row = { id: nextId("hc"), checkedAt: new Date(), ...data }; healthChecks.push(row); return row; }),
    },
    providerCircuitState: { findUnique: vi.fn(({ where: { providerId } }: any) => circuitStates.find((c) => c.providerId === providerId) ?? null) },
    tenantProviderOverride: { findUnique: vi.fn(({ where }: any) => overrides.find((o) => o.tenantId === where.tenantId_capabilityId.tenantId && o.capabilityId === where.tenantId_capabilityId.capabilityId) ?? null) },
    stickyRouteAssignment: {
      findUnique: vi.fn(() => null),
      upsert: vi.fn(({ create }: any) => { stickyAssignments.push(create); return create; }),
    },
    providerPriceSheetEntry: { findUnique: vi.fn(() => null) },
    saasWhiteLabelDomain: {
      create: vi.fn(({ data }: any) => { const row = { id: nextId("domain"), isVerified: false, status: "PENDING", createdAt: new Date(), ...data }; whiteLabelDomains.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => whiteLabelDomains.filter((d) => d.tenantId === where.tenantId)),
      findFirst: vi.fn(({ where }: any) => whiteLabelDomains.find((d) => d.id === where.id && d.tenantId === where.tenantId) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => { const row = whiteLabelDomains.find((d) => d.id === id)!; Object.assign(row, data); return row; }),
    },
  },
}));
vi.mock("@kannan19302/shared", () => ({ bindProvider: vi.fn(), unbindProvider: vi.fn() }));

import { ProviderRegistryService } from "./provider-registry.service";
import { RoutingService } from "./routing.service";
import { DnsService } from "./dns.service";
import { LoggedDnsAdapter } from "./adapters/logged-dns.adapter";
import { RegistrarDnsAdapter } from "./adapters/registrar-dns.adapter";
import { SaasWhiteLabelDeepService } from "../v1/white-label.service";
import { CertificateLifecycleService } from "../v1/certificate-lifecycle.service";
import { ControlPlaneAuditService } from "../v1/control-plane-audit.service";

describe("M22 · databases, CDN and DNS — multi-provider DNS", () => {
  let providersSvc: ProviderRegistryService;
  let routing: RoutingService;
  let dns: DnsService;

  beforeEach(() => {
    vi.clearAllMocks();
    providers = [];
    bindings = [];
    credentials = [];
    capabilityRows = [];
    overrides = [];
    stickyAssignments = [];
    circuitStates = [];
    priceEntries = [];
    healthConfigs = [];
    healthChecks = [];
    whiteLabelDomains = [];
    providersSvc = new ProviderRegistryService();
    routing = new RoutingService(providersSvc);
    dns = new DnsService(providersSvc, routing);
  });

  it("a DNS zone is served by the LOGGED provider when it is the only one registered — no code change from the registrar case", async () => {
    const provider = await dns.registerDnsProvider("logdns-primary", new LoggedDnsAdapter("will-be-set"));
    // Real adapters bind by providerId at registration time; re-register
    // with the actual id, exactly as CloudAccountService's onboarding does.
    const adapter = new LoggedDnsAdapter(provider.id);
    providersSvc.registerAdapter(provider.id, adapter);
    await providersSvc.recordHealthCheck(provider.id, { healthy: true });

    const result = await dns.manageRecord("tenant-1", { zoneName: "acme.com", recordType: "TXT", name: "_verify", value: "abc123" });
    expect(result.providerId).toBe(provider.id);
    expect(adapter.records).toHaveLength(1);
    expect(adapter.records[0]!.value).toBe("abc123");
  });

  it("the SAME zone is served by the REGISTRAR provider when it is the only one registered instead — no code change in DnsService or the caller", async () => {
    const provider = await dns.registerDnsProvider("registrar-primary", new RegistrarDnsAdapter("will-be-set"));
    const adapter = new RegistrarDnsAdapter(provider.id);
    providersSvc.registerAdapter(provider.id, adapter);
    await providersSvc.recordHealthCheck(provider.id, { healthy: true });

    const result = await dns.manageRecord("tenant-1", { zoneName: "acme.com", recordType: "TXT", name: "_verify", value: "abc123" });
    expect(result.providerId).toBe(provider.id);
    expect(adapter.zones.get("acme.com")?.TXT).toEqual([{ name: "_verify", value: "abc123" }]);
  });

  it("C26's custom-domain provisioning calls the DNS surface -- proven with only ONE implementation registered (the 'second' removed)", async () => {
    // Only the registrar adapter is registered here — the logged adapter
    // (the "second implementation") is never created at all in this test.
    const provider = await dns.registerDnsProvider("registrar-only", new RegistrarDnsAdapter("will-be-set"));
    const adapter = new RegistrarDnsAdapter(provider.id);
    providersSvc.registerAdapter(provider.id, adapter);
    await providersSvc.recordHealthCheck(provider.id, { healthy: true });

    const whiteLabel = new SaasWhiteLabelDeepService(dns, new CertificateLifecycleService(new ControlPlaneAuditService()));
    const domain = await whiteLabel.addCustomDomain("tenant-1", { customDomain: "shop.acme.com" });

    expect(domain.customDomain).toBe("shop.acme.com");
    expect(domain.verificationToken).toMatch(/^TOKEN-/);
    // The DNS record was actually provisioned through the registrar
    // adapter -- C26 did not skip DNS or duplicate it locally.
    const zone = adapter.zones.get("shop.acme.com");
    expect(zone?.TXT).toHaveLength(1);
    expect(zone!.TXT[0]!.value).toBe(domain.verificationToken);
  });

  it("two providers registered: priority order picks the primary, and a circuit-open primary fails over to the other — still no code change", async () => {
    const primary = await dns.registerDnsProvider("primary", new LoggedDnsAdapter("will-be-set"));
    const primaryAdapter = new LoggedDnsAdapter(primary.id);
    providersSvc.registerAdapter(primary.id, primaryAdapter);
    await providersSvc.recordHealthCheck(primary.id, { healthy: true });

    const secondary = await dns.registerDnsProvider("secondary", new RegistrarDnsAdapter("will-be-set"));
    const secondaryAdapter = new RegistrarDnsAdapter(secondary.id);
    providersSvc.registerAdapter(secondary.id, secondaryAdapter);
    await providersSvc.recordHealthCheck(secondary.id, { healthy: true });
    // Lower priority number sorts first (RoutingService orders asc).
    bindings.find((b) => b.providerId === secondary.id)!.priority = 200;

    const result1 = await dns.manageRecord("tenant-2", { zoneName: "b.com", recordType: "A", name: "@", value: "1.2.3.4" });
    expect(result1.providerId).toBe(primary.id);

    // Trip the primary's circuit open.
    circuitStates.push({ providerId: primary.id, state: "OPEN", openedAt: new Date(), failureCount: 999 });

    const result2 = await dns.manageRecord("tenant-2", { zoneName: "c.com", recordType: "A", name: "@", value: "5.6.7.8" });
    expect(result2.providerId).toBe(secondary.id);
  });
});
