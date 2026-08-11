/**
 * M32 — reference staff IdP adapter #1, SAML-shaped. Structurally
 * distinct from the OIDC adapter below (a simulated assertion exchange
 * vs a token exchange), the same "second, genuinely different instance"
 * pattern M05 established for dns.manage/email.send.
 */
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

export class SamlStaffIdpAdapter implements CapabilityAdapter {
  readonly capabilityId = "staff.identity";
  readonly authenticated: Array<{ nameId: string; sessionId: string }> = [];

  constructor(readonly providerId: string) {}

  async discover(): Promise<DiscoveredCapability[]> {
    return [{ capabilityId: this.capabilityId, detail: { protocol: "SAML2" } }];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    return { healthy: true, latencyMs: 8 };
  }

  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    const nameId = input.nameId as string | undefined;
    if (!nameId) {
      return { success: false, error: "staff.identity via SAML requires nameId" };
    }
    const sessionId = `saml-session-${this.authenticated.length + 1}`;
    this.authenticated.push({ nameId, sessionId });
    return { success: true, output: { sessionId, protocol: "SAML2" } };
  }
}
