/**
 * M41 — signed webhook delivery over the platform event outbox
 * (platform-event-bus.service.ts), in strict sequence order per endpoint.
 * `lastDeliveredSequence` is the cursor: a failing endpoint stops
 * advancing it, so a recovering endpoint resumes exactly where it left
 * off and receives its backlog once, in order — never skipped, never
 * duplicated, never reordered.
 */
import { Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { prisma } from "@kannan19302/database";

export interface WebhookTransport {
  send(url: string, body: string, signature: string): Promise<{ ok: boolean }>;
}

@Injectable()
export class WebhookDeliveryService {
  /** Pure — signs a delivery body with the endpoint's own secret (HMAC-SHA256). */
  sign(secret: string, body: string): string {
    return createHmac("sha256", secret).update(body).digest("hex");
  }

  /**
   * Delivers every undelivered event (sequence > lastDeliveredSequence,
   * filtered to the endpoint's subscribed eventTypes) to one endpoint, IN
   * ORDER. Stops and marks the endpoint unhealthy on the first failed
   * delivery — never skips ahead to a later event, which is what makes
   * "in order" true even across a partial backlog.
   */
  async deliverBacklog(endpointId: string, transport: WebhookTransport) {
    const endpoint = await (prisma as any).webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });

    const backlog = await (prisma as any).platformEventOutboxEntry.findMany({
      where: {
        sequence: { gt: endpoint.lastDeliveredSequence },
        eventType: { in: endpoint.eventTypes },
      },
      orderBy: { sequence: "asc" },
    });

    let delivered = 0;
    for (const event of backlog) {
      const body = JSON.stringify({ eventType: event.eventType, payload: event.payload, sequence: event.sequence.toString() });
      const signature = this.sign(endpoint.secret, body);
      const result = await transport.send(endpoint.url, body, signature);

      await (prisma as any).webhookDeliveryAttempt.create({
        data: { endpointId, sequence: event.sequence, eventType: event.eventType, success: result.ok },
      });

      if (!result.ok) {
        await (prisma as any).webhookEndpoint.update({ where: { id: endpointId }, data: { healthy: false } });
        return { delivered, stoppedAtSequence: event.sequence.toString(), healthy: false };
      }

      await (prisma as any).webhookEndpoint.update({ where: { id: endpointId }, data: { lastDeliveredSequence: event.sequence, healthy: true } });
      delivered += 1;
    }

    return { delivered, stoppedAtSequence: null, healthy: true };
  }
}
