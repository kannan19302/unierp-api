# API Security & Zero-Trust Governance Standards (`@kannan19302/api`)

This standard governs all authentication, authorization, session management, tenancy isolation, encryption, and audit policies across the UniERP API layer. Compliance is mandatory for all endpoints.

---

## 1. Zero-Trust Guard Chains & Route Decorators

Every route mounted in the application MUST declare explicit authentication, authorization, and tenant protection.

### 1.1 Tenant Plane Routes (`/api/v1/*`)
Default for all standard business modules (Finance, CRM, Inventory, HR, Sales, etc.):
```typescript
@ApiTags("crm")
@ApiBearerAuth()
@Controller("crm")
@UseGuards(JwtAuthGuard, RbacGuard)
export class CrmController {
  @Get("deals")
  @Permissions("crm.deals.read")
  async getDeals(...) { ... }

  @Post("deals")
  @Permissions("crm.deals.create")
  @UseInterceptors(IdempotencyInterceptor)
  async createDeal(@ZodBody(createDealSchema) body: CreateDealInput) { ... }
}
```

### 1.2 Control Plane Routes (`/platform/v1/*` or Cross-Tenant Operations)
Required for any endpoint performing platform-wide, multi-tenant, or infrastructure actions:
```typescript
@ApiTags("platform-admin")
@ApiBearerAuth()
@Controller("platform/v1/tenants")
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@SkipTenantScope()
export class TenantLifecycleController {
  @Post(":id/suspend")
  @Permissions("pcc.tenant.suspend")
  @UseGuards(TwoPersonControlGuard)
  async suspendTenant(@Param("id") tenantId: string) { ... }
}
```

### 1.3 Public Probes & Webhooks
Endpoints that do not require JWT authentication MUST declare an explicit `@Public()` decorator documenting the security rationale:
```typescript
@Public("Liveness probe for load balancer health checking")
@Get("health")
checkHealth() { ... }
```

---

## 2. Authorization Rules & Permission Namespaces

1. **Namespace Isolation:**
   - Control-plane permissions (`pcc.*`) MUST NOT be granted to tenant users.
   - Tenant-plane permissions (`occ.*` or `<module>.<resource>.<action>`) MUST NOT satisfy control-plane guard checks.
2. **Deny by Default:**
   - Any endpoint with a missing `@Permissions(...)` annotation fails closed with `403 Forbidden`.
   - Automated CI verification (`scripts/check-platform-permissions.mjs`) continuously checks every controller mounted in `PlatformModule`.

---

## 3. High-Security Controls & Dual-Person Approval

1. **Two-Person Control (`TwoPersonControlGuard`):**
   - High-impact destructive actions (tenant offboarding, cluster failover, manual data patch, privilege elevation) MUST require an approved `x-approval-token` header generated through the platform approval workflow.
2. **Step-Up MFA (`StepUpMfaGuard`):**
   - Operations handling export of PII, credential rotation, or financial disbursement require a verified recent MFA challenge token.
3. **Session Revocation & Inactivity Timeout:**
   - `JwtAuthGuard` checks the session status in the Identity Platform DB using the mandatory `sid` claim. Revoked or idle sessions (>30 minutes) are rejected immediately.

---

## 4. Input Validation & Data Cleansing

1. **Zod Validation on All Mutating Endpoints:**
   - Every `POST`, `PUT`, `PATCH` handler MUST use `@ZodBody(schema)` with schemas defined in `@kannan19302/shared` or `@kannan19302/contracts`.
   - Ad-hoc manual object casting (`req.body as any`) is strictly prohibited.
2. **Query Parameter Sanitization:**
   - Sort parameters and pagination bounds MUST pass through `buildPaginationValues` and `buildOrderBy` to prevent SQL injection or unindexed unbounded table scans.

---

## 5. Cryptography & PII Protection

1. **Field-Level Encryption:**
   - Sensitive PII (tax identifiers, banking details, personal phone numbers) and SSO client credentials MUST be encrypted using AES-256-GCM via `PII_ENCRYPTION_KEY` before persistence.
2. **Key Rotation & Keyrings:**
   - SSO secrets utilize the JSON keyring schema (`SSO_CONFIG_ENCRYPTION_KEYS`) to support active rotation without service downtime.
3. **Telemetry Redaction:**
   - Passwords, Bearer tokens, MFA secrets, and decrypted PII fields MUST NEVER appear in Pino logs, error envelopes, or OpenTelemetry trace spans.

---

## 6. Rate Limiting & Denial of Service Protection

1. **Plan-Aware Throttling (`TenantThrottlerGuard`):**
   - Automatically tracks request rates against tenant plan quotas (Free, Starter, Business, Enterprise) using Redis storage.
2. **Payload Size Guardrails:**
   - Global JSON / URL-encoded body limits are capped to prevent memory exhaustion attacks.
