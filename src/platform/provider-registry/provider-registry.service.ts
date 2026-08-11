import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { bindProvider, unbindProvider } from "@kannan19302/shared";
import type { ProviderAdapter } from "./provider-adapter.interface";

interface RegisterCredentialInput {
  /** A pointer into an external secrets manager — Vault path, cloud secrets
   *  ARN, etc. There is intentionally no `value`/`secret` field on this type:
   *  a caller cannot pass a literal secret to this service even by accident,
   *  because the type it must satisfy has nowhere to put one. */
  secretRef: string;
  label?: string;
  expiresAt?: Date;
}

/**
 * M03 — provider registration, credential lifecycle, and capability discovery.
 *
 * In-memory adapter registry: `ProviderAdapter` implementations are code
 * (M05's job to standardise), not data, so they are registered by process
 * startup rather than persisted. What IS persisted is what an adapter's
 * `discover()` call reported, in `ProviderCapability`.
 */
@Injectable()
export class ProviderRegistryService {
  private readonly adapters = new Map<string, ProviderAdapter>();

  async registerProvider(input: { name: string; description?: string }) {
    if (!input.name) {
      throw new BadRequestException("Provider name is required");
    }
    return (prisma as any).provider.create({
      data: { name: input.name, description: input.description ?? null },
    });
  }

  /** Attach code that knows how to talk to this provider. Not persisted. */
  registerAdapter(providerId: string, adapter: ProviderAdapter): void {
    this.adapters.set(providerId, adapter);
  }

  async bindCapability(providerId: string, capabilityId: string) {
    const provider = await (prisma as any).provider.findUnique({
      where: { id: providerId },
    });
    if (!provider) {
      throw new NotFoundException(`Provider ${providerId} not found`);
    }
    const binding = await (prisma as any).providerBinding.upsert({
      where: { providerId_capabilityId: { providerId, capabilityId } },
      create: { providerId, capabilityId },
      update: {},
    });
    // The capability-registry (M02) is the thing anything else in the
    // platform actually queries via resolve(). A binding that only exists in
    // this table and never reaches that registry is invisible to every
    // future caller — this call is what makes resolve() return READY.
    bindProvider(capabilityId, providerId);
    return binding;
  }

  async unbindCapability(providerId: string, capabilityId: string) {
    await (prisma as any).providerBinding.deleteMany({
      where: { providerId, capabilityId },
    });
    unbindProvider(capabilityId, providerId);
  }

  /**
   * `secretRef` is the only thing this method accepts that could conceivably
   * be secret-shaped, and it is a reference, never a value — this is the
   * exit criterion's "no credential value is persisted" enforced by the
   * absence of a field to persist, not by a redaction step that could be
   * forgotten.
   */
  async setCredential(providerId: string, input: RegisterCredentialInput) {
    if (!input.secretRef) {
      throw new BadRequestException("secretRef is required");
    }
    return (prisma as any).providerCredential.create({
      data: {
        providerId,
        secretRef: input.secretRef,
        label: input.label ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
  }

  /**
   * Calls the registered adapter's discover() and persists what it reports
   * as ProviderCapability rows — distinct from ProviderBinding, which is
   * only ever a claim. A provider with no registered adapter cannot be
   * discovered, and that failure is explicit rather than silently
   * returning an empty result indistinguishable from "discovered nothing."
   */
  async discoverCapabilities(providerId: string) {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new BadRequestException(
        `No adapter registered for provider ${providerId} — cannot discover against a provider with no way to call it`,
      );
    }
    const discovered = await adapter.discover();
    const rows: unknown[] = [];
    for (const cap of discovered) {
      rows.push(
        await (prisma as any).providerCapability.upsert({
          where: {
            providerId_capabilityId: { providerId, capabilityId: cap.capabilityId },
          },
          create: {
            providerId,
            capabilityId: cap.capabilityId,
            discoveryDetail: cap.detail ?? undefined,
          },
          update: {
            discoveredAt: new Date(),
            discoveryDetail: cap.detail ?? undefined,
          },
        }),
      );
    }
    return rows;
  }

  async getDiscoveredCapabilities(providerId: string) {
    return (prisma as any).providerCapability.findMany({ where: { providerId } });
  }

  async getProvidersForCapability(capabilityId: string) {
    const bindings = await (prisma as any).providerBinding.findMany({
      where: { capabilityId },
      include: { provider: true },
    });
    return bindings.map((b: any) => b.provider);
  }

  /**
   * The exit criterion's third assertion: "a credential past its expiry
   * disables its provider rather than failing a request." This runs the
   * check and applies the consequence — a scheduled caller (Track M's
   * automation, M45) is what would invoke this periodically; the mechanism
   * itself does not depend on being on a schedule to be correct.
   */
  async disableProvidersWithExpiredCredentials(): Promise<string[]> {
    const now = new Date();
    const expired = await (prisma as any).providerCredential.findMany({
      where: { expiresAt: { lt: now } },
      select: { providerId: true },
    });
    const providerIds = [...new Set(expired.map((c: any) => c.providerId))] as string[];
    for (const providerId of providerIds) {
      await (prisma as any).provider.update({
        where: { id: providerId },
        data: { status: "DISABLED_EXPIRED_CREDENTIAL" },
      });
    }
    return providerIds;
  }
}
