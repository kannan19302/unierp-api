import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import { randomUUID } from "crypto";
import { ControlPlaneAuditService } from "../../platform/v1/control-plane-audit.service";
import { SKIP_TENANT_SCOPE_KEY } from "../decorators/skip-tenant-scope.decorator";
import { pinoLogger } from "../services/logger.service";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface ProviderPrincipal {
  userId?: string;
  sub?: string;
  realm?: string;
}

/**
 * C03 / D048 — the tamper-evident audit log, actually wired.
 *
 * `ControlPlaneAuditService` existed, was unit-tested in isolation, and was
 * called from zero of the 22 mounted plane-1 controllers. `@TrackChanges(...)`
 * on ten of them was inert `SetMetadata` with no reader — `ChangeHistoryInterceptor`
 * is only applied via a per-handler `@UseInterceptors(...)` that none of them
 * carried. `AuditInterceptor` runs globally but writes to the plain `audit_logs`
 * table (no hash chain) and silently skips when `user.tenantId`/`userId` is
 * absent, which every plane-1 request satisfies since a control-plane session
 * has no `tenantId`. The net effect: no plane-1 mutation produced a
 * tamper-evident record, ever, in production.
 *
 * This interceptor closes that by running automatically on every mutating
 * request to a `@SkipTenantScope()` handler — the same marker
 * `ControlPlaneGuard` already uses to identify cross-tenant, plane-1 routes —
 * so a new controller is covered the moment it opts into that marker, with no
 * per-service integration to remember.
 *
 * KNOWN LIMITATION, stated rather than hidden: this is a post-hoc write, like
 * `AuditInterceptor`. By the time `tap()` runs, the mutating handler's own
 * Prisma call has already committed. That gives "an audit record is written
 * for every successful plane-1 mutation, automatically" — it does NOT give
 * "the mutation and its audit record commit or roll back together", which
 * `ControlPlaneAuditService`'s own docstring recommends via a shared `tx` and
 * which only per-service surgery across all 22 controllers can deliver. That
 * gap is filed separately; closing it here by hand, un-integration-tested
 * against a live Postgres+RLS stack, is a worse risk than leaving it visible.
 *
 * A write failure here is NOT silently swallowed the way `AuditInterceptor`'s
 * is: it is logged at `error`, not `warn`, because a lost plane-1 audit
 * record is the exact event `verifyChain()` exists to make undetectable-only-
 * to-an-attacker, not undetectable to us.
 */
@Injectable()
export class ControlPlaneAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: ControlPlaneAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;

    const isControlPlane = this.reflector.getAllAndOverride<boolean>(
      SKIP_TENANT_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isControlPlane || !MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((result) => {
        void this.record(req, method, context, result);
      }),
    );
  }

  private async record(
    req: {
      user?: ProviderPrincipal;
      originalUrl?: string;
      url: string;
      params?: Record<string, string>;
      ip?: string;
      headers: Record<string, unknown>;
      body?: unknown;
    },
    method: string,
    context: ExecutionContext,
    result: unknown,
  ): Promise<void> {
    const user = req.user;
    const actorId = user?.userId ?? user?.sub;
    if (!actorId) {
      // A mutating plane-1 request with no identified actor should already be
      // impossible — ControlPlaneGuard denies before this ever runs. If it
      // ever happens, that is itself worth surfacing loudly rather than
      // silently declining to audit an unattributable mutation.
      pinoLogger.error(
        { path: req.originalUrl ?? req.url, method },
        "control-plane audit: mutating request reached the audit interceptor with no actor identity",
      );
      return;
    }

    const path = (req.originalUrl ?? req.url).split("?")[0] ?? "";
    const controllerName = context.getClass().name;
    const handlerName = context.getHandler().name;
    const targetId =
      req.params?.tenantId ??
      req.params?.id ??
      (result as { id?: string })?.id ??
      null;

    const correlationId =
      (req.headers["x-correlation-id"] as string) ?? randomUUID();

    try {
      await this.audit.record({
        actorId,
        actorRole: user?.realm ?? "unknown",
        action: `${controllerName}.${handlerName}`,
        targetId,
        details: {
          method,
          path,
          body: this.safeBody(req.body),
        },
        correlationId,
        ipAddress: req.ip ?? null,
      });
    } catch (err) {
      pinoLogger.error(
        { err, path, actorId, targetId },
        "control-plane audit: tamper-evident record write FAILED for a completed plane-1 mutation",
      );
    }
  }

  private safeBody(body: unknown): object | undefined {
    if (!body || typeof body !== "object") return undefined;
    const redactKeys = ["password", "token", "secret", "apiKey", "key"];
    const clone: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      clone[k] = redactKeys.some((r) => k.toLowerCase().includes(r))
        ? "[redacted]"
        : v;
    }
    return clone;
  }
}
