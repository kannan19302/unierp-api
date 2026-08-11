/**
 * M42 — multi-provider email delivery for the platform's notification
 * engine (C21/A21), on M03/M05/M06's provider-registry/adapter/routing
 * mechanism rather than a second, hardcoded SMTP path. sendEmail() walks
 * M06's ordered candidate list and tries each in turn, stopping at the
 * FIRST success — same-call failover to the secondary provider when the
 * primary fails, with no duplicate delivery by construction (the loop
 * returns the instant one attempt succeeds; every provider tried before
 * that point failed and therefore never delivered anything).
 */
import { Injectable } from "@nestjs/common";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { RoutingService } from "../provider-registry/routing.service";
import type { CapabilityAdapter } from "../provider-registry/adapter-contract";

export const EMAIL_CAPABILITY = "email.send";

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailDeliveryResult {
  providerId: string;
  reason: string;
  attempts: Array<{ providerId: string; success: boolean }>;
}

@Injectable()
export class NotificationRoutingService {
  constructor(
    private readonly providers: ProviderRegistryService,
    private readonly routing: RoutingService,
  ) {}

  async sendEmail(tenantId: string, message: EmailMessage): Promise<EmailDeliveryResult> {
    const candidates = await this.routing.resolveCandidates({ tenantId, capabilityId: EMAIL_CAPABILITY });
    const attempts: Array<{ providerId: string; success: boolean }> = [];

    for (const candidate of candidates) {
      const adapter = this.providers.getAdapter(candidate.providerId) as CapabilityAdapter | undefined;
      if (!adapter) continue;

      const result = await adapter.execute({ to: message.to, subject: message.subject, body: message.body });
      await this.routing.recordCall(candidate.providerId, EMAIL_CAPABILITY, { success: result.success });
      attempts.push({ providerId: candidate.providerId, success: result.success });

      if (result.success) {
        return { providerId: candidate.providerId, reason: candidate.reason, attempts };
      }
    }

    throw new Error(
      `email.send failed on every candidate provider: ${attempts.map((a) => a.providerId).join(", ") || "none routable"}`,
    );
  }
}
