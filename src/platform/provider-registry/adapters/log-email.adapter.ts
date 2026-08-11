/**
 * M05 — reference adapter #2 for `email.send`.
 *
 * A log/console-backed adapter: records what would have been sent instead of
 * sending it, and reports success. This is a standard, legitimate pattern
 * for local development and CI (Django's `console.EmailBackend`, Rails'
 * `test` delivery method are the same idea) — not a fake standing in for a
 * vendor. It is genuinely useful on its own, and it proves the abstraction
 * with a second, structurally different implementation: no SMTP connection,
 * no network I/O, a different failure mode entirely (this adapter can never
 * be network-unhealthy) — exactly the second instance the exit criterion
 * asks for, so the contract is proven rather than merely asserted by a
 * single implementation.
 */
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

export interface LoggedEmail {
  to: string;
  subject: string;
  body: string;
  loggedAt: Date;
}

export class LogEmailAdapter implements CapabilityAdapter {
  readonly capabilityId = "email.send";
  readonly sent: LoggedEmail[] = [];

  constructor(readonly providerId: string) {}

  async discover(): Promise<DiscoveredCapability[]> {
    return [{ capabilityId: this.capabilityId, detail: { transport: "log", environment: "dev/test" } }];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    // No external dependency — this adapter is healthy by construction,
    // which is itself the honest, correct answer for a log-only backend.
    return { healthy: true, latencyMs: 0 };
  }

  async execute(input: Record<string, unknown>): Promise<ExecutionResult> {
    const to = input.to as string | undefined;
    const subject = input.subject as string | undefined;
    const body = input.body as string | undefined;
    if (!to || !subject || !body) {
      return {
        success: false,
        error: `email.send requires to, subject and body — got ${JSON.stringify(Object.keys(input))}`,
      };
    }
    const record: LoggedEmail = { to, subject, body, loggedAt: new Date() };
    this.sent.push(record);
    return { success: true, output: { messageId: `log-${this.sent.length}` } };
  }
}
