import { Injectable } from "@nestjs/common";
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
} from "@nestjs/throttler";
import { Reflector } from "@nestjs/core";
import { verifyTypedToken, TOKEN_TYPE } from "@unerp/auth";
import { TENANT_PLAN_LIMITS, FREE_PLAN_LIMITS } from "./tenant-plan-limits";
import { TenantPlanService } from "./tenant-plan.service";

const AUTH_COOKIE = "auth_token";
const REPORT_PATH = "/api/v1/reporting/engine";

/**
 * Per-tenant throttling with plan-based tiers and Redis backing.
 *
 * ORDERING HAZARD (the bug this guard fixes): this guard is registered as a
 * global APP_GUARD, and in NestJS every guard — global or per-route — runs
 * before every interceptor. Controller-level JwtAuthGuard therefore runs
 * AFTER this guard, so `req.user` is always absent at throttle time. Reading
 * identity from `req.user` (as the original implementation did) silently
 * collapsed to the IP fallback and throttled every tenant behind one shared
 * `ip:` bucket: one tenant's runaway load throttled every other tenant on the
 * same IP. Same hazard as TenantWriteGuard; unlike it, the throttler must keep
 * throttling unauthenticated traffic (login/register floods), so it stays a
 * guard but resolves identity from the token itself rather than from
 * `req.user`.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly planService: TenantPlanService,
  ) {
    super(options, storageService, reflector);
  }

  private resolveIdentity(req: Record<string, any>): {
    tenantId: string;
    userId?: string;
  } | null {
    if (req.__throttleIdentity) return req.__throttleIdentity;

    if (req.user?.tenantId) {
      req.__throttleIdentity = {
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      };
      return req.__throttleIdentity;
    }

    // No guard has run before us, so read the session token ourselves. Signature
    // verification is cheap; a bad token just falls back to an IP bucket and
    // never fails the request (the throttler is not an auth boundary).
    let token: string | undefined = req.cookies?.[AUTH_COOKIE];
    if (!token) {
      const authHeader = req.headers?.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }
    if (!token) return null;

    const decoded = verifyTypedToken<{ tenantId?: string; userId?: string }>(
      token,
      TOKEN_TYPE.SESSION,
    );
    if (!decoded?.tenantId) return null;

    req.__throttleIdentity = {
      tenantId: decoded.tenantId,
      userId: decoded.userId,
    };
    return req.__throttleIdentity;
  }

  async getTracker(req: Record<string, any>): Promise<string> {
    const identity = this.resolveIdentity(req);
    if (identity) {
      if (identity.userId?.startsWith("apikey:")) {
        return `apikey:${identity.tenantId}:${identity.userId}`;
      }
      return `tenant:${identity.tenantId}`;
    }
    return `ip:${req.ip}`;
  }

  /**
   * Effective limit for a request: plan tier, per-throttler name, with the
   * reporting-engine endpoints tightened to the `report` per-minute budget.
   */
  protected async planLimitFor(
    req: Record<string, any>,
    throttlerName: string,
  ): Promise<number | undefined> {
    const identity = this.resolveIdentity(req);
    const tenantPlan = identity
      ? await this.planService.getPlan(identity.tenantId)
      : "free";
    const planLimits =
      TENANT_PLAN_LIMITS[tenantPlan] ?? FREE_PLAN_LIMITS;

    const path: string = req.originalUrl || req.url || "";
    const isReportRoute = path.startsWith(REPORT_PATH);
    if (isReportRoute && throttlerName === "medium") {
      return planLimits.report;
    }
    return planLimits[throttlerName];
  }

  async handleRequest(requestProps: any): Promise<boolean> {
    const { req } = this.getRequestResponse(requestProps.context);
    const limit = await this.planLimitFor(req, requestProps.throttler.name);
    if (limit !== undefined) {
      requestProps = { ...requestProps, limit };
    }
    return super.handleRequest(requestProps);
  }
}
