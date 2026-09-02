# API Module Extraction & Cell Architecture Guide (`@kannan19302/api`)

This guide provides the step-by-step procedure for extracting vertical industry modules from the monolithic NestJS runtime into dedicated, out-of-process cell services or microservices.

---

## 1. Extraction Priority & Criteria

When a domain expands in complexity or exhibits distinct scaling, compute, or compliance requirements, it should be extracted from the monolith.

### Priority Candidates:
1. **`healthcare`** (HIPAA compliance boundary, isolated patient data stores)
2. **`education`** (High student concurrency bursts, academic session models)
3. **`real-estate`** (Heavy document management, specialized property workflows)

### Extraction Criteria Checklist:
- [ ] Module comprises >50 source files.
- [ ] Contains vertical industry features rather than core horizontal ERP capability.
- [ ] Has zero synchronous in-memory state dependencies on other modules.
- [ ] Interacts with core domains (Finance, Sales, Inventory) purely via published events and outbox messages.

---

## 2. Extraction Step-by-Step Procedure

```
┌────────────────────────────────────────────────────────┐
│ Phase 1: Formalize Interface in @kannan19302/contracts │
│          (TypeScript interfaces, Zod DTOs, events)     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Phase 2: Create Standalone Service Repository          │
│          (e.g., packages/service-healthcare)           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Phase 3: Route Traffic via ExtGatewayModule            │
│          (Reverse proxy /api/v1/healthcare/*)          │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Phase 4: Deprecate & Remove In-Process NestJS Module   │
│          (Remove from app.module.ts imports)           │
└────────────────────────────────────────────────────────┘
```

---

## 3. Cell-Based Routing & Tenant Workload Isolation

The API platform supports **Cell Architecture** via `RuntimeCellAssignment` and `RuntimeCellRouter` in `src/developer/platform/`:

1. **Cell Assignment:**
   - Tenants on dedicated tiers can be routed to dedicated regional database clusters and cell instances.
2. **Gateway Ingress Proxying:**
   - `ExtGatewayModule` proxies `/ext/<appSlug>/*` requests to external cell endpoints using service-to-service signed JWTs (`EXT_SERVICE_JWT_SECRET`).
3. **Event Transport Migration:**
   - In-memory event emitters (`EventEmitter2`) are replaced with **Apache Kafka** topic partitions keyed by `tenantId`, guaranteeing strict partition-ordered processing per tenant across cell replicas.
