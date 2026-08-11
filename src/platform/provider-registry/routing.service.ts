import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ProviderRegistryService } from "./provider-registry.service";

export type RoutingReason = "pinned" | "sticky" | "primary" | "fallback";

export interface RoutingDecision {
  providerId: string;
  reason: RoutingReason;
}

export interface RoutingRequest {
  tenantId: string;
  capabilityId: string;
  /** For sticky routing: calls sharing a stickyKey return to the same provider. */
  stickyKey?: string;
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;
const QUOTA_WINDOW_MS = 60_000;

/**
 * M06 — the routing engine. Selection order, each step absolute over the
 * ones below it:
 *
 *   1. Tenant pin (TenantProviderOverride) — bypasses everything else. A
 *      pinned tenant gets the pinned provider even while every other
 *      tenant is failing over away from it. The pin is a deliberate
 *      operator choice, not a suggestion this router second-guesses —
 *      whether the resulting call then succeeds is the caller's problem.
 *   2. Sticky assignment — if one exists AND its provider is still routable.
 *   3. Priority order among bindings, filtered by: circuit breaker not
 *      open, M04 health (not excluded from routing), and quota not
 *      exhausted for this window.
 *
 * "No code change" (the exit criterion's exact phrase) means what it says:
 * disabling a provider is a DATA change — a health check, a circuit trip —
 * the router already reads on every call. Nothing here branches on a
 * specific provider id.
 */
@Injectable()
export class RoutingService {
  /** In-memory per-window call counts. Real usage metering belongs to the
   *  execution pipeline (M12); this is the minimal real mechanism M06 needs
   *  to prove quota-awareness rather than only declare it. */
  private readonly usage = new Map<string, { count: number; windowStart: number; exceeded: boolean }>();

  constructor(private readonly providers: ProviderRegistryService) {}

  async resolve(request: RoutingRequest): Promise<RoutingDecision> {
    const override = await (prisma as any).tenantProviderOverride.findUnique({
      where: {
        tenantId_capabilityId: { tenantId: request.tenantId, capabilityId: request.capabilityId },
      },
    });
    if (override) {
      return { providerId: override.providerId, reason: "pinned" };
    }

    if (request.stickyKey) {
      const sticky = await (prisma as any).stickyRouteAssignment.findUnique({
        where: {
          tenantId_capabilityId_stickyKey: {
            tenantId: request.tenantId,
            capabilityId: request.capabilityId,
            stickyKey: request.stickyKey,
          },
        },
      });
      if (sticky && (await this.isRoutable(sticky.providerId, request.capabilityId))) {
        return { providerId: sticky.providerId, reason: "sticky" };
      }
    }

    const bindings = await (prisma as any).providerBinding.findMany({
      where: { capabilityId: request.capabilityId },
      orderBy: { priority: "asc" },
    });

    for (let i = 0; i < bindings.length; i++) {
      const providerId = bindings[i].providerId;
      if (await this.isRoutable(providerId, request.capabilityId)) {
        const reason: RoutingReason = i === 0 ? "primary" : "fallback";
        if (request.stickyKey) {
          await this.pinSticky(request.tenantId, request.capabilityId, request.stickyKey, providerId);
        }
        return { providerId, reason };
      }
    }

    throw new Error(
      `No routable provider for capability "${request.capabilityId}" — all bound providers are excluded (unhealthy, circuit-open, or quota-exhausted)`,
    );
  }

  private async isRoutable(providerId: string, capabilityId: string): Promise<boolean> {
    if (await this.isCircuitOpen(providerId)) return false;
    if (await this.providers.isExcludedFromRouting(providerId)) return false;
    if (this.isQuotaExhausted(providerId, capabilityId)) return false;
    return true;
  }

  private async isCircuitOpen(providerId: string): Promise<boolean> {
    const state = await (prisma as any).providerCircuitState.findUnique({ where: { providerId } });
    if (!state?.openedAt) return false;
    const cooledDown = Date.now() - new Date(state.openedAt).getTime() > CIRCUIT_COOLDOWN_MS;
    return !cooledDown; // still open until the cool-down window has passed
  }

  private isQuotaExhausted(providerId: string, capabilityId: string): boolean {
    const key = `${providerId}:${capabilityId}`;
    const entry = this.usage.get(key);
    return entry?.exceeded === true;
  }

  /**
   * The caller (the execution pipeline, later) reports each call's outcome
   * so the next resolve() can see accumulated usage and the circuit breaker
   * can react. A failed call moves the breaker toward open; a success
   * resets it — that reset is deliberate: a provider that recovers is
   * routable again on its next success, not stuck open for the full
   * cool-down once it's actually healthy again.
   */
  async recordCall(
    providerId: string,
    capabilityId: string,
    outcome: { success: boolean },
    quotaLimit?: number,
  ): Promise<void> {
    const key = `${providerId}:${capabilityId}`;
    const now = Date.now();
    let entry = this.usage.get(key);
    if (!entry || now - entry.windowStart > QUOTA_WINDOW_MS) {
      entry = { count: 0, windowStart: now, exceeded: false };
      this.usage.set(key, entry);
    }
    entry.count += 1;
    if (quotaLimit !== undefined && entry.count >= quotaLimit) {
      entry.exceeded = true;
    }

    await this.recordCircuitOutcome(providerId, outcome.success);
  }

  private async recordCircuitOutcome(providerId: string, success: boolean): Promise<void> {
    const existing = await (prisma as any).providerCircuitState.findUnique({ where: { providerId } });

    if (success) {
      if (existing) {
        await (prisma as any).providerCircuitState.update({
          where: { providerId },
          data: { consecutiveFailures: 0, openedAt: null },
        });
      } else {
        await (prisma as any).providerCircuitState.create({
          data: { providerId, consecutiveFailures: 0, openedAt: null },
        });
      }
      return;
    }

    const failures = (existing?.consecutiveFailures ?? 0) + 1;
    const openedAt = failures >= CIRCUIT_FAILURE_THRESHOLD ? new Date() : (existing?.openedAt ?? null);
    if (existing) {
      await (prisma as any).providerCircuitState.update({
        where: { providerId },
        data: { consecutiveFailures: failures, openedAt },
      });
    } else {
      await (prisma as any).providerCircuitState.create({
        data: { providerId, consecutiveFailures: failures, openedAt },
      });
    }
  }

  async pinTenant(tenantId: string, capabilityId: string, providerId: string, reason?: string) {
    return (prisma as any).tenantProviderOverride.upsert({
      where: { tenantId_capabilityId: { tenantId, capabilityId } },
      create: { tenantId, capabilityId, providerId, reason: reason ?? null },
      update: { providerId, reason: reason ?? null },
    });
  }

  async unpinTenant(tenantId: string, capabilityId: string) {
    await (prisma as any).tenantProviderOverride.deleteMany({ where: { tenantId, capabilityId } });
  }

  private async pinSticky(tenantId: string, capabilityId: string, stickyKey: string, providerId: string) {
    await (prisma as any).stickyRouteAssignment.upsert({
      where: { tenantId_capabilityId_stickyKey: { tenantId, capabilityId, stickyKey } },
      create: { tenantId, capabilityId, stickyKey, providerId },
      update: { providerId },
    });
  }
}
