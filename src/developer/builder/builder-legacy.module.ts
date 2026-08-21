import { Module } from "@nestjs/common";
import { BuilderModule } from "./builder.module";

/**
 * The deprecated `/api/v1/builder/*` surface, behind one import.
 *
 * Plan phase P4. `BuilderModule` wires 15 controllers and ~25 services that
 * together own 143 routes; every one of them is announced as deprecated in
 * `common/versioning/deprecation-registry.ts` with `/api/v1/dev` as its
 * successor. The point of this wrapper is that removing the legacy surface
 * becomes a one-line change in `app.module.ts` — delete the
 * `BuilderLegacyModule` import — instead of an archaeology exercise across
 * fifteen files.
 *
 * It re-exports rather than re-declares deliberately. Moving the controller
 * list into this file would be a large, mechanical, conflict-prone diff whose
 * only benefit is where the `controllers: [...]` array physically lives —
 * while the actual goal (a single, obvious removal point, and no ambiguity
 * about which surface is legacy) is achieved either way. The routes, guards
 * and services stay exactly where they are and behave identically.
 *
 * REMOVAL CHECKLIST, in order:
 *   1. `GET /api/v1/dev/deprecations/usage` on EVERY replica reports zero for
 *      `/api/v1/builder` (counts are per-process — see deprecation-usage.ts).
 *   2. `GET /api/v1/dev/artifacts/reconcile` reports no drift, i.e. nothing
 *      is still writing artifacts through the legacy controllers.
 *   3. A `sunsetAt` was announced in the deprecation registry at least two
 *      release cycles earlier, and the tenants named in (1) were told.
 *   4. Only then: drop this import, delete `builder/`, and move the expired
 *      registry entries into the history table in docs/API_VERSIONING_POLICY.md.
 *
 * Steps 1 and 2 are the reason those two endpoints exist at all. Skipping
 * them turns "deprecated" into "broke someone's integration".
 */
@Module({
  imports: [BuilderModule],
  exports: [BuilderModule],
})
export class BuilderLegacyModule {}
