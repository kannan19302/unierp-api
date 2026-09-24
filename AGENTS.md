    <!-- UniERP-Agent-Protocol: 1.1.0 -->
    # api agent rules

    This is the only repository agent instruction file. Read [the workspace entrypoint](../AGENTS.md),
    the [canonical protocol](../platform/docs/standards/AI_AGENT_DEVELOPMENT_PROTOCOL.md),
    the enterprise brain, applicable accepted ADRs and the owning platform requirements before
    material work. Follow authority precedence; this file narrows implementation behavior only.
    If a required authority is missing, stop before mutation.

    **Layer:** L3. **Accountable platform:** PLT-BIZ. **Scope:** Business services and domain API.
    Resolve actual dependencies, packages and scripts from current manifests and the platform catalog.
    Preserve unrelated changes. Define numbered acceptance criteria and a knowledge delta before editing.
    For coordinated changes, publish the change contract, validate upstream first, and hand off
    to downstream consumers with exact evidence.

    ## Repository rules

    - Change the owned published contract and data migration first. Keep controllers thin, validate DTOs and deny unknown authority at the server.
- Enforce tenant and record scope on HTTP, jobs, listeners, sockets, search and exports. Provider and tenant permissions remain separate.
- Commit business state, required audit and outbox events atomically. Make retries idempotent and failures observable; avoid private cross-module imports.

    ## Verification

    Run applicable commands from this repository, plus risk-specific contract, security, data,
    accessibility, integration, migration or release gates required by the canonical protocol:
    pnpm typecheck; pnpm lint; pnpm security:plane1; pnpm test; pnpm build; node ../platform/workspace/scripts/check-layer.mjs

    A command's presence here is not proof that it ran. Report exact results, failures and NOT RUN
    reasons; review the diff; then follow the canonical status and source-control procedure.
