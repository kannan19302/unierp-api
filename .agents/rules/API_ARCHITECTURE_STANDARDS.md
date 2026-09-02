# API Architecture Standards & Governance (`@kannan19302/api`)

This document defines the authoritative architecture, module boundaries, layering, and domain invariants for the UniERP API service. Every AI agent and software engineer modifying or extending this repository MUST strictly follow these standards to maintain a 10/10 enterprise-grade architecture.

---

## 1. Domain Module Anatomy (Mandatory Uniform 6-Directory Anatomy)

Every business domain module under `src/modules/<domain>/` MUST follow the uniform directory structure enforced by `scripts/check-module-anatomy.mjs`:

```
src/modules/<domain>/
├── controllers/              # [Layer 1: Transport] HTTP REST Controllers, Gateways & Route Handlers
│   ├── <domain>.controller.ts
│   └── ...
├── services/                 # [Layer 2: Application / Domain Logic] Orchestration, Business Rules & Engines
│   ├── <domain>.service.ts
│   └── ...
├── repositories/             # [Layer 3: Persistence] Data Access Repositories (Prisma abstractions)
│   ├── <domain>.repository.ts
│   └── ...
├── events/                   # [Layer 4: Async Messaging] Kafka / Outbox / Event-Emitter Handlers
│   ├── <domain>.event-handler.ts
│   └── ...
├── dto/                      # [Layer 5: Contracts & DTOs] Request / Response Zod Schemas & Types
│   ├── <domain>.dto.ts
│   └── ...
├── tests/                    # [Layer 6: Quality] Co-located Unit, Integration & Isolation Specs
│   ├── <domain>.service.spec.ts
│   └── ...
├── <domain>.module.ts        # Module Container: Dependency Injection bindings & Public Exports
└── index.ts                  # Public Module Barrel Export
```

### Layer Responsibilities & Strict Boundaries

1. **Controllers (`*.controller.ts`):**
   - **Role:** Pure HTTP adapter. Extracts URL params, query filters, and authenticated user/tenant context.
   - **Rules:**
     - Must ALWAYS validate input payloads using `@ZodBody(schema)` with schemas from `@kannan19302/contracts` or `@kannan19302/shared`.
     - Must ALWAYS declare authorization guards: `@UseGuards(JwtAuthGuard, RbacGuard)` and explicit `@Permissions(...)`.
     - MUST NOT execute business logic, DB queries, or multi-step coordination directly.
     - MUST NOT import `prisma` or repository classes directly.

2. **Services (`*.service.ts`):**
   - **Role:** Domain logic, business invariants, workflow coordination, and event emission.
   - **Rules:**
     - MUST be pure domain logic. Must NOT import Express types (`Request`, `Response`, `NextFunction`).
     - MUST NOT import `prisma` from `@kannan19302/database` directly. All database access MUST be delegated to the module's repository.
     - Must throw NestJS domain exceptions (`BadRequestException`, `NotFoundException`, `ConflictException`, `ForbiddenException`).
     - Must publish cross-module events via `OutboxService` or `EventEmitter2`.

3. **Domain Repositories (`*.repository.ts`):**
   - **Role:** Data access abstraction. Isolates Prisma query construction, relations, pagination, and sorting.
   - **Rules:**
     - The ONLY component permitted to import `prisma` from `@kannan19302/database`.
     - Relies on the `@kannan19302/database` AsyncLocalStorage tenant extension; does not construct ad-hoc raw SQL bypassing tenant context.
     - Returns typed domain models and paginated collections.

4. **Event Handlers (`*.event-handler.ts`):**
   - **Role:** Responds to domain events (`@OnEvent('domain.event')`) for asynchronous tasks (notifications, audit, indexation).
   - **Rules:**
     - Idempotent execution. Retries must not corrupt state.

---

## 2. Service Layer Purity & Repository Pattern

Direct ORM access inside service files creates tight database coupling and degrades unit testability.

### Anti-Pattern (Forbidden):
```typescript
// ❌ FORBIDDEN: Direct Prisma usage in business service
@Injectable()
export class InvoiceService {
  async getInvoices(tenantId: string) {
    return prisma.invoice.findMany({ where: { tenantId } });
  }
}
```

### Correct Pattern (Mandatory):
```typescript
// ✅ MANDATORY: Repository encapsulation
@Injectable()
export class InvoiceRepository {
  async findMany(params: FindInvoicesParams): Promise<PaginatedResult<Invoice>> {
    const { skip, take } = buildPaginationValues(params);
    const [records, total] = await Promise.all([
      prisma.invoice.findMany({
        where: params.where,
        include: { lineItems: true, customer: true },
        skip,
        take,
      }),
      prisma.invoice.count({ where: params.where }),
    ]);
    return paginatedResult(records, total, params);
  }
}

@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly outboxService: OutboxService,
  ) {}

  async getInvoices(params: PaginationParams) {
    return this.invoiceRepo.findMany(params);
  }
}
```

---

## 3. Cross-Module Communication & Decoupling

Direct deep imports across modules (`src/modules/A` importing `src/modules/B/service.b.ts`) are strictly forbidden by `.dependency-cruiser.cjs` and `check-module-boundaries.mjs`.

### Approved Communication Channels:
1. **In-Process Domain Events:** Use `EventEmitter2` (`@nestjs/event-emitter`) with typed payloads defined in `@kannan19302/contracts`.
2. **Transactional Outbox Events:** Use `OutboxService.writeEvent(tx, event)` when state mutation and event dispatch must be strictly atomic.
3. **Asynchronous Background Queues:** Use BullMQ / Redis queues for asynchronous heavy tasks (PDF generation, bulk email, batch imports).
4. **Distributed Messaging (Apache Kafka):** Cross-service streaming and external pub/sub pipelines MUST use Kafka topics with schema-registry validated contracts.
5. **Out-of-Process Services:** Route through `ExtGatewayModule` for extracted cell/microservice applications.

---

## 4. Multi-Tenant Invariants & Isolation

1. **Server-Side Context:** Tenant identity is resolved from signed token claims and bound via `TenantInterceptor` using `AsyncLocalStorage`.
2. **No Client-Supplied Tenant Trusts:** An endpoint MUST NOT accept `tenantId` in the body or query params to scope database operations on the tenant plane.
3. **Database RLS:** All tenant queries execute under the PostgreSQL connection variable `set_config('app.current_tenant_id', ...)`.
4. **Plane Separation:** Provider Control Plane (`pcc.*`) and Tenant Plane (`occ.*`) MUST never be mixed. Handlers requiring cross-tenant reads MUST be annotated with `@SkipTenantScope()` and guarded by `ControlPlaneGuard`.

---

## 5. Monetary Arithmetic & Precision Invariants

1. **Zero Raw Numbers for Money:** Financial amounts MUST be represented as exact decimals (`Prisma.Decimal` or `string`), accompanied by an ISO-4217 currency code.
2. **Precision Calculations:** Multiplications, tax calculations, and currency exchanges MUST use arbitrary-precision libraries (e.g. `decimal.js`).
3. **Immutable History:** Posted invoices, ledger journals, and completed payments MUST NOT be deleted; modifications require credit notes, void records, or reversal entries.

---

## 6. Adoption Roadmap & Pilots

- **Pilot Modules (Repository Pattern):**
  1. `finance` (Exemplar: `finance.repository.ts`)
  2. `inventory` (`stock.repository.ts`, `warehouse.repository.ts`)
  3. `sales` (`orders.repository.ts`, `quotations.repository.ts`)
- **Extraction Candidates (Cell / Microservice Architecture):**
  1. `healthcare`
  2. `education`
  3. `real-estate`

---

## 7. Directory Hierarchy & Test Topology Standards (10/10 Standard)

To maintain a clean, enterprise-grade codebase, the repository topology is strictly partitioned:

```
src/
├── common/             # Cross-cutting platform concerns (auth, guards, filters, pipes, idempotency, outbox)
├── platform/           # Provider Control Plane (cloud providers, operation pipelines, resource models, v1)
├── modules/<domain>/   # 33 Canonical Unified Domain Bounded Contexts
└── (root entrypoints)  # main.ts, app.module.ts, tracing.ts, health.controller.ts, metrics.controller.ts

test/
├── live/               # Live integration & compliance verification runners
└── *.itest.ts          # PostgreSQL RLS tenant isolation & multi-module integration suites
```

### Invariants:
1. **Zero Domain Logic in `src/common/` or root `src/`:** All domain capabilities MUST reside in `src/modules/<domain>/`.
2. **Zero Test Runner Scripts in `src/`:** Live verification scripts and integration harnesses MUST reside in `test/` or `test/live/`.
3. **No Split Normal/Advanced Folders:** All advanced, portal, and secondary domain features are unified inside their canonical domain (e.g., `hr`, `finance`, `saas`, `documents`, `extensions`, `field-service`, `analytics`).
4. **Enforced Uniform Anatomy:** Every domain module MUST contain `controllers/`, `services/`, `repositories/`, `events/`, `dto/`, and `tests/` with 0 misplaced root files, verified by `pnpm architecture:check`.

