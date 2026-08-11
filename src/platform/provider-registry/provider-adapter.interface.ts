/**
 * M03's own minimal notion of "calling out to the live provider" — enough to
 * prove registration and discovery genuinely work, NOT the full conformance
 * contract M05 ("Provider adapter contract and the reference pair") owns.
 * M05 formalises this interface, builds the conformance test suite against
 * it, and ships the first real vendor pair; this file is deliberately not
 * that, and should be superseded by M05 rather than extended in place.
 */
export interface DiscoveredCapability {
  capabilityId: string;
  detail?: Record<string, unknown>;
}

export interface ProviderAdapter {
  /** Ask the provider what it can actually do — as opposed to what a
   *  ProviderBinding merely claims. */
  discover(): Promise<DiscoveredCapability[]>;
}
