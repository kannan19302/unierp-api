/**
 * M22 — reference DNS adapter #2 for `dns.manage`. Structurally distinct
 * from `LoggedDnsAdapter`: records are keyed by zone into a per-zone map
 * (the shape a real registrar's zone-file model actually has — one zone
 * owns many records, not a flat log), and health depends on an explicit
 * flag rather than being unconditionally true, so this adapter CAN be
 * unhealthy, which the log-backed one structurally cannot — the second,
 * genuinely different instance M05's own conformance suite requires
 * before a capability counts as proven plural, applied to `dns.manage`.
 */
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

export interface ZoneRecordSet {
  [recordType: string]: Array<{ name: string; value: string }>;
}

export class RegistrarDnsAdapter implements CapabilityAdapter {
  readonly capabilityId = "dns.manage";
  readonly zones = new Map<string, ZoneRecordSet>();
  healthy = true;

  constructor(readonly providerId: string) {}

  async discover(): Promise<DiscoveredCapability[]> {
    return [{ capabilityId: this.capabilityId, detail: { transport: "registrar-zonefile" } }];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    return this.healthy ? { healthy: true, latencyMs: 12 } : { healthy: false, error: "registrar API unreachable" };
  }

  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    const zoneName = input.zoneName as string | undefined;
    const recordType = input.recordType as string | undefined;
    const name = input.name as string | undefined;
    const value = input.value as string | undefined;
    if (!zoneName || !recordType || !name || !value) {
      return {
        success: false,
        error: `dns.manage requires zoneName, recordType, name and value — got ${JSON.stringify(Object.keys(input))}`,
      };
    }
    const zone = this.zones.get(zoneName) ?? {};
    const existing = zone[recordType] ?? [];
    zone[recordType] = [...existing, { name, value }];
    this.zones.set(zoneName, zone);
    return { success: true, output: { zoneName, recordCount: zone[recordType].length } };
  }
}
