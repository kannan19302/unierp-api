/**
 * M41 — the platform event catalogue and outbox. Every platform event is
 * DOCUMENTED (PLATFORM_EVENT_CATALOG, checked at emit time — emitting an
 * undeclared eventType is refused, never silently accepted) and every
 * emission writes exactly one PlatformEventOutboxEntry row with a
 * strictly-increasing `sequence` — the single global order replay and
 * webhook delivery both read off. No delivery happens inside emit(): the
 * outbox is the only path out.
 */
import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export interface PlatformEventDefinition {
  eventType: string;
  description: string;
}

/** The one place every platform event is declared. `emit()` refuses
 *  anything not listed here — "documented" is enforced, not aspirational. */
export const PLATFORM_EVENT_CATALOG: PlatformEventDefinition[] = [
  { eventType: "resource.drift-detected", description: "M07/M13 — a resource's observed state diverged from its desired state" },
  { eventType: "plan.executed", description: "M09/M12 — a plan finished executing as a durable job" },
  { eventType: "incident.opened", description: "M35 — an SLO breach opened an incident" },
  { eventType: "retention.certified", description: "M37 — a retention schedule run completed and was certified" },
];

@Injectable()
export class PlatformEventBusService {
  isDocumented(eventType: string): boolean {
    return PLATFORM_EVENT_CATALOG.some((e) => e.eventType === eventType);
  }

  async emit(eventType: string, payload: Record<string, unknown>) {
    if (!this.isDocumented(eventType)) {
      throw new BadRequestException(`"${eventType}" is not a documented platform event — add it to PLATFORM_EVENT_CATALOG first`);
    }
    return (prisma as any).platformEventOutboxEntry.create({
      data: { eventType, payload },
    });
  }

  /** Replay: every event with sequence > `sinceSequence`, in order. A pure
   *  read — replaying never re-emits or mutates the outbox. */
  async replay(sinceSequence: bigint = 0n) {
    return (prisma as any).platformEventOutboxEntry.findMany({
      where: { sequence: { gt: sinceSequence } },
      orderBy: { sequence: "asc" },
    });
  }
}
