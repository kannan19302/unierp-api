/**
 * M22 — reference DNS adapter #1 for `dns.manage`. A log-backed adapter,
 * the same legitimate pattern M05's LogEmailAdapter already established:
 * records what would have been provisioned instead of calling a live
 * registrar API, genuinely useful for dev/test and structurally distinct
 * enough from adapter #2 (below) to prove the DNS capability is plural,
 * not merely declared plural.
 */
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

export interface DnsRecord {
  zoneName: string;
  recordType: string;
  name: string;
  value: string;
  createdAt: Date;
}

export class LoggedDnsAdapter implements CapabilityAdapter {
  readonly capabilityId = "dns.manage";
  readonly records: DnsRecord[] = [];

  constructor(readonly providerId: string) {}

  async discover(): Promise<DiscoveredCapability[]> {
    return [{ capabilityId: this.capabilityId, detail: { transport: "log", environment: "dev/test" } }];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    return { healthy: true, latencyMs: 0 };
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
    const record: DnsRecord = { zoneName, recordType, name, value, createdAt: new Date() };
    this.records.push(record);
    return { success: true, output: { recordId: `logdns-${this.records.length}` } };
  }
}
