/**
 * M05 — reference adapter #1 for `email.send`.
 *
 * Wraps nodemailer directly, the same real library `common/queues/email.processor.ts`
 * already uses for the platform's single hard-coded SMTP transport (configured via
 * `common/platform-credentials/provider-registry.ts`'s "smtp" spec — one instance,
 * no fallback, exactly the shape Track M's invariant exists to end). This adapter
 * does not touch that processor; it is a new, parallel implementation proving the
 * CapabilityAdapter contract against a real transport, not a second production
 * mail path.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { CapabilityAdapter, ExecutionResult, HealthProbeResult } from "../adapter-contract";
import type { DiscoveredCapability } from "../provider-adapter.interface";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export class SmtpEmailAdapter implements CapabilityAdapter {
  readonly capabilityId = "email.send";
  private transporter: Transporter;

  constructor(
    readonly providerId: string,
    private readonly config: SmtpConfig,
  ) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      auth: { user: config.user, pass: config.password },
    });
  }

  async discover(): Promise<DiscoveredCapability[]> {
    return [{ capabilityId: this.capabilityId, detail: { transport: "smtp", host: this.config.host } }];
  }

  async checkHealth(): Promise<HealthProbeResult> {
    const start = Date.now();
    try {
      await this.transporter.verify();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, error: err instanceof Error ? err.message : String(err) };
    }
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
    try {
      const info = await this.transporter.sendMail({ from: this.config.from, to, subject, html: body });
      return { success: true, output: { messageId: info.messageId } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
