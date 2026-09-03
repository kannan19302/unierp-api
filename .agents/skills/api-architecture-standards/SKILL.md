---
name: api-architecture-standards
description: Authoritative standards, architectural boundaries, coding anatomy, and verification gates for api.
version: 1.0.0
author: UniERP Architecture Governance
---

# UniERP Core Enterprise Business API — AI Agent Guidance & Project Skill

This skill governs all code modification, analysis, and testing within `api` (**Layer L3: Service**). Every AI agent and software engineer working in this repository MUST follow these rules without exception.

---

## 🏛️ 1. Architectural Position & Boundary Rules

- **Repository**: `api`
- **Layer**: **L3 (Service)**
- **Package Identity**: `@kannan19302/api`
- **Allowed Inbound Callers**: L4 (Presentation apps), L5 (Clients)
- **Allowed Outbound Dependencies**: @kannan19302/contracts (L0); L1 packages; L2 packages (data, framework, blockchain)
- **STRICTLY FORBIDDEN DEPENDENCIES**:
  - ❌ Layers L4-L7
  - ❌ Direct UI imports

> **Unidirectional Rule**: You may ONLY import published artifacts from strictly lower layers. Sibling imports within the same layer are prohibited unless mediated through L0 contracts.

---

## 🎯 2. The Platform Goal & Repository Mandate

> **Platform North Star Goal**:  
> "Build the world's premier autonomous, multi-tenant Enterprise SaaS Operating System: 100% Zero-Trust Multi-Tenant Isolation, Absolute Decimal(19,4) Numeric Precision, Atomic Durable Audit Logging, Sub-100ms P99 Latency, and Strata Workbench High-Density UI."

### Repository Responsibility Mandate
33 modular business domains (Finance, HR, CRM, SCM, etc.) adhering to the strict 6-part module anatomy with thin controllers and domain repositories.

---

## 📐 3. Repository-Specific Coding Standards

### Mandatory 6-Part Module Anatomy
Every business module under `src/modules/<module-name>/` MUST contain:
1. `<name>.module.ts`: NestJS dependency injection container.
2. `controllers/<name>.controller.ts`: Thin HTTP handler with `@UseGuards(JwtAuthGuard, RbacGuard)`, `@Permissions(...)`, and `@ZodBody()`.
3. `services/<name>.service.ts`: Pure business domain orchestration.
4. `repositories/<name>.repository.ts`: Domain repository encapsulating all Prisma access.
5. `events/<name>.event-handler.ts`: Async event dispatchers and outbox publishers.
6. `tests/`: Co-located unit and repository tests.

---

## 🛡️ 4. Mandatory Pre-Commit Verification Gate

Before submitting or reporting completion on any change in this repository, run and verify:

```bash
pnpm test && pnpm typecheck
```

All tests must pass with 0 failures and 0 type errors.
