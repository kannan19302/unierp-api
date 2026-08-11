/**
 * M32 — multi-provider staff IdP via M03. "A second IdP is added without
 * code change" is this file's own shape: `authenticateStaff()` never
 * imports a specific adapter class, only resolves a provider via M06's
 * routing and calls `execute()` on whichever adapter that resolves to —
 * the same discipline M22's DnsService already established for DNS.
 */
import { Injectable } from "@nestjs/common";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { RoutingService } from "../provider-registry/routing.service";
import type { CapabilityAdapter } from "../provider-registry/adapter-contract";
import type { ProviderAdapter } from "../provider-registry/provider-adapter.interface";

const STAFF_IDENTITY_CAPABILITY = "staff.identity";

@Injectable()
export class StaffIdpService {
  constructor(
    private readonly providers: ProviderRegistryService,
    private readonly routing: RoutingService,
  ) {}

  async registerIdpProvider(providerName: string, adapter: ProviderAdapter & CapabilityAdapter) {
    const provider = await this.providers.registerProvider({ name: providerName });
    await this.providers.bindCapability(provider.id, STAFF_IDENTITY_CAPABILITY);
    this.providers.registerAdapter(provider.id, adapter);
    return provider;
  }

  async authenticateStaff(operatorId: string, nameId: string) {
    const decision = await this.routing.resolve({ tenantId: "platform", capabilityId: STAFF_IDENTITY_CAPABILITY, stickyKey: operatorId });
    const adapter = this.providers.getAdapter(decision.providerId) as CapabilityAdapter | undefined;
    if (!adapter) {
      throw new Error(`Provider ${decision.providerId} was routed to but has no registered adapter`);
    }
    const result = await adapter.execute({ nameId });
    if (!result.success) {
      throw new Error(`Staff authentication failed via provider ${decision.providerId}: ${result.error}`);
    }
    return { providerId: decision.providerId, reason: decision.reason, ...result.output };
  }
}
