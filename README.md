# unierp-api

**Layer L3** of the UniERP layered repository architecture
(`PLATFORM_ARCHITECTURE.md` § 4.2). Publishes container image.

## Why it is its own repository

The modular monolith: platform/ + tenant/ + modules/ + developer/. One deployable, two routers. The 45 business modules stay here deliberately (§ 4.4) — they are separated by module boundaries, not repository boundaries, because finance, inventory and commerce write to each other constantly and splitting them means a distributed transaction on the most correctness-critical paths in the system.

## The invariant

**A repository may depend only on published artifacts of a strictly lower
layer. Never sideways within a layer. Never upward.** A cycle is not
discouraged — it is unrepresentable, because the lower layer's package cannot
name the higher one.

## Extraction status

Extracted from the `ERPSys` monorepo as § 14 Phase 3, with history preserved
via `git-filter-repo`.

**The monorepo copy remains authoritative.** Consumers switch to published
packages only once those packages are publishable; the monorepo stays buildable
at each extraction tag until they do. Rollback is a one-line `pnpm` override
pointing consumers back at the workspace path.
