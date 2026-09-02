# API Testing & Quality Assurance Standards (`@kannan19302/api`)

This document defines the testing pyramid, quality gates, tenant isolation assertions, and mutation testing standards for the UniERP API repository. Every contribution MUST meet these verification requirements.

---

## 1. Test Pyramid Structure

Every module in `src/modules/<name>/` MUST supply tests across three distinct layers:

```
           / \
          /   \     Integration & Tenant Isolation Tests (*.itest.ts)
         /-----\    - Real PostgreSQL with NOBYPASSRLS & RLS enabled
        /       \   
       /---------\  Unit & Boundary Tests (*.spec.ts)
      /           \ - Services, Repositories, Guards, Filters, Interceptors
     /-------------\
```

---

## 2. Testing Layers & Requirements

### 2.1 Unit Tests (`*.spec.ts`)
- **Scope:** Co-located under `src/modules/<name>/tests/` or alongside the source file.
- **Coverage Expectation:**
  - 100% of public methods in `*.service.ts` and `*.repository.ts`.
  - Positive scenario (valid input produces expected result).
  - Negative scenarios (validation failure, record not found, unauthorized tenant access, concurrency conflict).
- **Execution:** Fast, in-memory execution using Vitest mocks.

### 2.2 Integration & Tenant Isolation Tests (`*.itest.ts`)
- **Scope:** Located in `test/` or `src/modules/<name>/tests/*.itest.ts`.
- **Mandatory Assertions for every Domain Entity:**
  1. **Isolation Test:** Tenant A creates a record. Tenant B queries the collection. Assertion: Tenant B receives 0 records.
  2. **Cross-Tenant Mutation Denial:** Tenant B attempts to update or delete Tenant A's record ID. Assertion: Fails with `404 Not Found` or `403 Forbidden`.
  3. **No-Context Test:** A query executed without active tenant context returns empty or throws, never leaking data.
  4. **RLS Role Check:** Runs against the application `unerp_api` role with `NOBYPASSRLS`.

### 2.3 Stryker Mutation Testing
- **Configuration:** `stryker.conf.json` defines mutant generation on core algorithmic services (e.g. `finance.service.ts`, `tax-engine.service.ts`, `stock-valuation.service.ts`, `rbac.guard.ts`).
- **Goal:** Mutation score >= 60% across critical calculation and security routines. Tests must assert exact values rather than generic truthiness.

---

## 3. Standard Test Suite Template (Unit + Repository Mocking)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvoiceService } from "../invoice.service";
import { InvoiceRepository } from "../invoice.repository";
import { OutboxService } from "../../../common/outbox/outbox.service";
import { NotFoundException } from "@nestjs/common";

describe("InvoiceService", () => {
  let service: InvoiceService;
  let repo: InvoiceRepository;
  let outbox: OutboxService;

  beforeEach(() => {
    repo = {
      findById: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
    } as unknown as InvoiceRepository;

    outbox = {
      writeEvent: vi.fn().mockResolvedValue({ eventId: "evt-1" }),
    } as unknown as OutboxService;

    service = new InvoiceService(repo, outbox);
  });

  describe("getInvoiceById", () => {
    it("returns invoice when found", async () => {
      const mockInvoice = { id: "inv-1", amount: "100.00", currency: "USD" };
      vi.spyOn(repo, "findById").mockResolvedValue(mockInvoice as any);

      const result = await service.getInvoiceById("tenant-1", "inv-1");
      expect(result).toEqual(mockInvoice);
      expect(repo.findById).toHaveBeenCalledWith("tenant-1", "inv-1");
    });

    it("throws NotFoundException when invoice does not exist", async () => {
      vi.spyOn(repo, "findById").mockResolvedValue(null);

      await expect(service.getInvoiceById("tenant-1", "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
```

---

## 4. Mandatory Quality Gates Before Commit

Every developer and AI agent MUST execute and pass the following quality pipeline before declaring a cycle complete:

```bash
# 1. Typecheck: Zero compiler diagnostics
pnpm typecheck

# 2. Unit & Integration test suite pass
pnpm test

# 3. Security plane authorization gate
pnpm security:plane1

# 4. Architectural boundaries and service purity
pnpm architecture:check

# 5. Lint rules (no swallowed catches, naming conventions)
pnpm lint
```
