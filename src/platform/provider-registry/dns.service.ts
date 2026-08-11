/**
 * M22 — multi-provider DNS. This is the ONE surface any caller uses to
 * manage a record; which real provider serves it is M06's routing
 * decision (priority, health, circuit breaker — all data, never a
 * branch on a provider id). "A DNS zone is served by either registered
 * provider without a code change" is this file's own shape: it never
 * imports a specific adapter class, only calls `execute()` on whichever
 * one M06 resolved.
 */
import { Injectable } from "@nestjs/common";
import { ProviderRegistryService } from "./provider-registry.service";
import { RoutingService } from "./routing.service";
import type { CapabilityAdapter } from "./adapter-contract";
import type { ProviderAdapter } from "./provider-adapter.interface";

const DNS_CAPABILITY = "dns.manage";

export interface DnsRecordInput {
  zoneName: string;
  recordType: string;
  name: string;
  value: string;
}

@Injectable()
export class DnsService {
  constructor(
    private readonly providers: ProviderRegistryService,
    private readonly routing: RoutingService,
  ) {}

  /** Registers a DNS-capable provider: bound to dns.manage (M03/M06) and
   *  given the code that actually talks to it (M05's adapter contract). */
  async registerDnsProvider(providerName: string, adapter: ProviderAdapter & CapabilityAdapter) {
    const provider = await this.providers.registerProvider({ name: providerName });
    await this.providers.bindCapability(provider.id, DNS_CAPABILITY);
    this.providers.registerAdapter(provider.id, adapter);
    return provider;
  }

  /**
   * Manages one DNS record. Every caller in the platform that needs DNS —
   * C26's custom-domain flow included — calls THIS method, never a
   * provider-specific client directly. Which provider actually serves the
   * call is M06's routing decision, not this method's.
   */
  async manageRecord(tenantId: string, input: DnsRecordInput) {
    const decision = await this.routing.resolve({ tenantId, capabilityId: DNS_CAPABILITY, stickyKey: input.zoneName });
    const adapter = this.providers.getAdapter(decision.providerId) as CapabilityAdapter | undefined;
    if (!adapter) {
      throw new Error(`Provider ${decision.providerId} was routed to but has no registered adapter`);
    }
    const result = await adapter.execute({
      zoneName: input.zoneName,
      recordType: input.recordType,
      name: input.name,
      value: input.value,
    });
    if (!result.success) {
      throw new Error(`DNS record creation failed via provider ${decision.providerId}: ${result.error}`);
    }
    return { providerId: decision.providerId, reason: decision.reason, ...result.output };
  }
}
