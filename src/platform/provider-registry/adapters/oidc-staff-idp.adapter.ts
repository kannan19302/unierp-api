/**
 * M32 — reference staff IdP adapter #2, OIDC-shaped. Token-keyed rather
 * than assertion-keyed, distinct enough from the SAML adapter to prove
 * `staff.identity` is genuinely plural, not merely declared plural.
 */
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

export class OidcStaffIdpAdapter implements CapabilityAdapter {
  readonly capabilityId = "staff.identity";
  readonly issuedTokens: Array<{ subject: string; accessToken: string }> = [];

  constructor(readonly providerId: string) {}

  async discover(): Promise<DiscoveredCapability[]> {
    return [{ capabilityId: this.capabilityId, detail: { protocol: "OIDC" } }];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    return { healthy: true, latencyMs: 5 };
  }

  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    const subject = input.nameId as string | undefined;
    if (!subject) {
      return { success: false, error: "staff.identity via OIDC requires nameId (used as subject)" };
    }
    const accessToken = `oidc-token-${this.issuedTokens.length + 1}`;
    this.issuedTokens.push({ subject, accessToken });
    return { success: true, output: { accessToken, protocol: "OIDC" } };
  }
}
