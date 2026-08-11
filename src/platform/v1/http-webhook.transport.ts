/**
 * M41 — the real (non-test) WebhookTransport: an HTTP POST carrying the
 * HMAC signature webhook-delivery.service.ts computed, in a header a
 * subscriber verifies against their own copy of the endpoint's secret.
 */
import { Injectable } from "@nestjs/common";
import type { WebhookTransport } from "./webhook-delivery.service";

@Injectable()
export class HttpWebhookTransport implements WebhookTransport {
  async send(url: string, body: string, signature: string): Promise<{ ok: boolean }> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-signature": signature },
        body,
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  }
}
