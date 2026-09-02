<!-- UniERP-Agent-Protocol: 1.1.0 -->
# UniERP Repository Agent Entrypoint

This repository is one delivery unit in the UniERP polyrepo. Before analysis, planning, review, or mutation, every
AI agent from every provider MUST read and follow:

1. the workspace entrypoint at [`../AGENTS.md`](../AGENTS.md);
2. the canonical standard at
   [`../unierp-platform/docs/standards/AI_AGENT_DEVELOPMENT_PROTOCOL.md`](../unierp-platform/docs/standards/AI_AGENT_DEVELOPMENT_PROTOCOL.md);
3. the owning platform documents selected through
   [`../unierp-platform/docs/PLATFORM_CATALOG.md`](../unierp-platform/docs/PLATFORM_CATALOG.md).

If the workspace entrypoint or canonical standard is unavailable, the protocol bundle is incomplete. The agent
MUST stop before mutation and report the missing dependency. This bootstrap adds no weaker or conflicting rules.
Repository-specific additions may be appended below only when they narrow implementation behavior without
redefining platform ownership, security, contracts, or cross-platform standards.

---

## API Repository — Architecture Governance Standards (10/10 Standard)

Every AI agent and software engineer working in this repository MUST read and adhere to the following standards under `.agents/rules/` before designing, implementing, or modifying code:

1. **Architecture & Domain Layering:** [`.agents/rules/API_ARCHITECTURE_STANDARDS.md`](.agents/rules/API_ARCHITECTURE_STANDARDS.md)
   - Mandatory 6-part module anatomy (`module`, `controller`, `service`, `repository`, `event-handler`, `tests`).
   - Domain Repository pattern for all data access (services MUST NOT import `prisma` directly for new code).
   - Strict controller thinness and DTO validation with `@ZodBody`.
   - Pilot modules: `finance` (`finance.repository.ts`), `inventory`, `sales`.
2. **Zero-Trust Security & Tenancy:** [`.agents/rules/API_SECURITY_STANDARDS.md`](.agents/rules/API_SECURITY_STANDARDS.md)
   - Mandatory `@UseGuards(JwtAuthGuard, RbacGuard)` and explicit `@Permissions(...)` on all tenant routes.
   - Control-plane boundary enforcement (`ControlPlaneGuard`, `TwoPersonControlGuard`, `@SkipTenantScope()`).
   - Field-level AES-256 PII encryption and keyring rotation.
3. **Quality Engineering & Testing:** [`.agents/rules/API_TESTING_STANDARDS.md`](.agents/rules/API_TESTING_STANDARDS.md)
   - Unit tests co-located with services and repositories.
   - Mandatory 4-part tenant isolation assertions on PostgreSQL with `NOBYPASSRLS`.
   - Stryker mutation testing on calculation and security engines.
4. **Observability & SRE:** [`.agents/rules/API_OBSERVABILITY_STANDARDS.md`](.agents/rules/API_OBSERVABILITY_STANDARDS.md)
   - Structured JSON logging via Pino with mandatory context (`requestId`, `tenantId`, `userId`, `action`).
   - OpenTelemetry distributed tracing and Prometheus metrics.
   - Standardized `AllExceptionsFilter` error envelopes.
5. **Contract Governance:** [`.agents/rules/API_CONTRACT_STANDARDS.md`](.agents/rules/API_CONTRACT_STANDARDS.md)
   - Contract-first design in `@kannan19302/contracts`.
   - RFC 9745 (`Deprecation`) and RFC 8594 (`Sunset`) versioning policy.
   - Comprehensive OpenAPI/Swagger annotations.
6. **Module Extraction & Cell Architecture:** [`.agents/rules/API_MODULE_EXTRACTION_GUIDE.md`](.agents/rules/API_MODULE_EXTRACTION_GUIDE.md)
   - Vertical extraction guidelines for `healthcare`, `education`, and `real-estate`.
   - Apache Kafka event streaming for distributed cross-service workflows.

