/**
 * M16 — cloud provider accounts as first-class resources. The exit
 * criterion is specific: "a second cloud account of a DIFFERENT provider
 * is onboarded through the UI and its inventory appears in the estate
 * WITHOUT A CODE CHANGE." That constraint is what shapes this file — a
 * single generic adapter, driven entirely by data supplied at onboarding
 * time (`inventoryKinds`), rather than one TypeScript class per cloud
 * vendor. Onboarding "a second, different provider" is a new row, never a
 * new class.
 *
 * Composes three already-built mechanisms rather than inventing a fourth:
 *   - M03 ProviderRegistryService: registers the provider, binds the
 *     credential as a secret-ref (never a value — enforced by M03's own
 *     type, not repeated here), and runs discovery.
 *   - M07 ResourceModelService: each discovered inventory kind becomes a
 *     Resource, which is what makes it "appear in the estate" — M15's
 *     search reads the same Resource table.
 */
import { Injectable } from "@nestjs/common";
import { ProviderRegistryService } from "./provider-registry.service";
import { ResourceModelService } from "../resource-model/resource-model.service";
import type { DiscoveredCapability, ProviderAdapter } from "./provider-adapter.interface";

/**
 * Data-driven discovery: what this account reports having is exactly the
 * `inventoryKinds` supplied at onboarding, not a hardcoded per-vendor list.
 * A real integration would replace `discover()`'s body with an actual SDK
 * call; the shape it must return is unchanged, so that swap never touches
 * `CloudAccountService` or the onboarding endpoint.
 */
class GenericCloudAdapter implements ProviderAdapter {
  constructor(private readonly inventoryKinds: string[]) {}

  async discover(): Promise<DiscoveredCapability[]> {
    return this.inventoryKinds.map((kind) => ({ capabilityId: kind, detail: { source: "cloud-account-onboarding" } }));
  }
}

export interface OnboardCloudAccountInput {
  /** Human-readable account name, e.g. "acme-prod-aws". Must be globally
   *  unique the same way M03's Provider.name already is. */
  accountName: string;
  /** Free-text vendor label ("aws", "azure", "gcp", ...) — never branches
   *  any code path; recorded only as data on the account resource. */
  providerType: string;
  /** Pointer into an external secrets manager. No literal secret accepted. */
  secretRef: string;
  /** What this account reports it has — org hierarchy, subscriptions,
   *  compute, storage, whatever the vendor exposes. Onboarding a
   *  DIFFERENT provider just supplies a different list here. */
  inventoryKinds: string[];
}

@Injectable()
export class CloudAccountService {
  constructor(
    private readonly providers: ProviderRegistryService,
    private readonly resources: ResourceModelService,
  ) {}

  async onboardAccount(input: OnboardCloudAccountInput) {
    await this.resources.registerResourceKind("cloud-account", "A cloud provider account onboarded via M16");

    const provider = await this.providers.registerProvider({
      name: input.accountName,
      description: `Cloud account (${input.providerType})`,
    });

    await this.providers.setCredential(provider.id, { secretRef: input.secretRef, label: input.providerType });

    this.providers.registerAdapter(provider.id, new GenericCloudAdapter(input.inventoryKinds));
    const discovered = await this.providers.discoverCapabilities(provider.id);

    const accountResource = await this.resources.createResource("cloud-account", input.accountName, {
      providerId: provider.id,
      providerType: input.providerType,
      inventoryKinds: input.inventoryKinds,
    });

    // Each discovered inventory kind becomes its own resource kind and
    // resource, so it shows up in M15's estate search individually rather
    // than being buried inside the account's own desired state.
    const inventoryResources: Awaited<ReturnType<ResourceModelService["createResource"]>>[] = [];
    for (const kind of input.inventoryKinds) {
      const resourceKindName = `cloud-account.${input.providerType}.${kind}`;
      await this.resources.registerResourceKind(resourceKindName, `${input.providerType} ${kind} inventory`);
      const resource = await this.resources.createResource(
        resourceKindName,
        `${input.accountName} · ${kind}`,
        { accountResourceId: accountResource.id, providerId: provider.id },
      );
      inventoryResources.push(resource);
    }

    return { provider, accountResource, discovered, inventoryResources };
  }
}
