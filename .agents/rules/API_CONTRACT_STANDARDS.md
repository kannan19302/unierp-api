# API Contract Governance & Versioning Standards (`@kannan19302/api`)

This document defines contract governance, OpenAPI specifications, Zod schema validation, and lifecycle deprecation headers for all public and internal REST surfaces in the UniERP API service.

---

## 1. Contract-First Development Lifecycle

All API design and modification MUST proceed from formal published contracts rather than ad-hoc controller edits.

```
┌──────────────────────────────────────────────────────────┐
│ 1. Define Zod Schemas in @kannan19302/contracts          │
│    (Request Inputs, Response DTOs, Enums)                │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│ 2. Mount Zod Schemas in NestJS Controllers (@ZodBody)    │
│    and Document in OpenAPI (Swagger)                     │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│ 3. Implement Domain Logic & Repository Invariants        │
└──────────────────────────────────────────────────────────┘
```

---

## 2. OpenAPI / Swagger Annotations

Every controller and route method MUST be fully annotated for auto-generated OpenAPI documentation (`/swagger`):

```typescript
@ApiTags("inventory")
@ApiBearerAuth()
@Controller("inventory/products")
export class ProductController {
  @ApiOperation({ summary: "List inventory products with warehouse stock levels" })
  @ApiResponse({ status: 200, description: "Paginated list of products" })
  @ApiResponse({ status: 400, description: "Invalid filter parameters" })
  @Get()
  @Permissions("inventory.products.read")
  async getProducts(@Query() query: ProductFilterDto) { ... }
}
```

---

## 3. Deprecation & Sunset Lifecycle (RFC 9745 / RFC 8594)

Deprecating an API endpoint MUST follow a formal 3-phase sunset policy managed in `src/common/versioning/deprecation-registry.ts`:

1. **Registry Declaration:**
```typescript
export const API_DEPRECATIONS: DeprecationEntry[] = [
  {
    pathPrefix: "/api/v1/builder/",
    deprecatedAt: new Date("2026-06-01T00:00:00Z"),
    sunsetAt: new Date("2026-12-31T23:59:59Z"),
    successor: "/api/v1/dev/",
    link: "https://docs.unierp.dev/migration/builder-to-dev-platform",
  },
];
```
2. **Automatic RFC Header Injection:**
   - The `deprecationMiddleware` (`src/common/versioning/deprecation.middleware.ts`) automatically intercepts matching routes and attaches:
     - `Deprecation: @<timestamp>` (RFC 9745)
     - `Sunset: <HTTP-Date>` (RFC 8594)
     - `Link: <successor-url>; rel="successor-version"`
3. **Usage Metering:**
   - Deprecated route invocations are counted per tenant via `recordDeprecatedUsage` to verify zero traffic before physical endpoint deletion.

---

## 4. Response Envelopes & Pagination Standards

1. **Success Envelope:**
   - Single item: Returns entity payload directly or `{ data: T }`.
   - Collections: MUST return standardized `PaginatedResult<T>`:
```typescript
export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
```
2. **Idempotency Support:**
   - State-changing operations (`POST`, `PUT`, `PATCH`) SHOULD be annotated with `@UseInterceptors(IdempotencyInterceptor)` and honor client-sent `Idempotency-Key` headers.
