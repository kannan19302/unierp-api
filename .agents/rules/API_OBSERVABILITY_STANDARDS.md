# API Observability, Telemetry & SRE Standards (`@kannan19302/api`)

This standard governs structured logging, Prometheus metrics, OpenTelemetry distributed tracing, error envelopes, and health probe readiness for the UniERP API service.

---

## 1. Structured Logging (Pino)

All logging throughout the API repository MUST use structured JSON output through `pinoLogger` / `AppLogger`.

### Mandatory Log Context:
- `requestId`: Propagated from the `x-request-id` HTTP header.
- `tenantId`: Active tenant context (if authenticated).
- `userId`: Authenticated principal ID.
- `action`: Canonical business action descriptor (e.g. `INVOICE_POSTED`, `ORDER_CANCELLED`).
- `entityType` & `entityId`: The target domain entity.

### Rules:
- ❌ **NEVER** use `console.log`, `console.error`, or `console.warn` in application code.
- ❌ **NEVER** log raw credit card numbers, passwords, Bearer tokens, or decrypted PII.
- ✅ Always use structured context objects:
```typescript
pinoLogger.info(
  {
    requestId,
    tenantId,
    userId,
    entityType: "Invoice",
    entityId: invoice.id,
    action: "INVOICE_CREATED",
  },
  "Invoice successfully created and posted",
);
```

---

## 2. Distributed Tracing (OpenTelemetry)

The API service initializes OpenTelemetry before module loading in `src/tracing.ts`.

### Trace Guidelines:
- **Trace Propagation:** HTTP headers (`traceparent`, `tracestate`) must propagate across inter-service HTTP calls and Kafka message headers.
- **Custom Spans:** Long-running calculations, batch payroll runs, MRP computations, and external integrations MUST wrap execution in custom spans:
```typescript
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("unierp-api");

async function executePayrollCalculation(...) {
  return tracer.startActiveSpan("payroll.calculate", async (span) => {
    try {
      span.setAttribute("tenant.id", tenantId);
      span.setAttribute("payroll.entry_count", entries.length);
      const result = await processCalculation();
      return result;
    } finally {
      span.end();
    }
  });
}
```

---

## 3. Prometheus Metrics & KPIs

Standard RED (Rate, Errors, Duration) metrics are exposed at `/metrics` via `prom-client`.

### Domain-Specific Counters & Histograms:
Modules with high transactional throughput SHOULD register domain metrics in `src/metrics.controller.ts` or module providers:
- `business_invoices_created_total` (labels: `tenant_plan`, `currency`, `status`)
- `business_orders_placed_total` (labels: `sales_channel`, `payment_method`)
- `external_integration_duration_seconds` (labels: `integration_name`, `outcome`)

---

## 4. Standardized Error Enveloping

All uncaught exceptions are intercepted by `AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`) and serialized into a uniform, machine-readable envelope:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "Validation failed",
  "requestId": "req_8f29ba31",
  "timestamp": "2026-09-01T18:45:00.000Z",
  "path": "/api/v1/finance/invoices",
  "errors": [
    {
      "code": "invalid_type",
      "expected": "string",
      "received": "undefined",
      "path": ["customerId"],
      "message": "Required"
    }
  ]
}
```

---

## 5. Health Probes & Readiness Protocol

- **Liveness Probe (`GET /health`):** Verifies the Node.js event loop and HTTP server are active.
- **Readiness Probe (`GET /ready`):** Returns `200 OK` only when critical dependencies (PostgreSQL pool, Redis cluster, Kafka connection) respond within acceptable latency bounds (`<500ms`). Returns `503 Service Unavailable` on degraded dependencies to remove the pod from load balancer routing.
