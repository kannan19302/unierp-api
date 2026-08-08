import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { Observable, finalize } from "rxjs";
import { TenantPlanService } from "./tenant-plan.service";

/**
 * Per-tenant concurrency budget for report-engine queries (connection-pool and
 * query-budget fairness). Runs as a controller-level interceptor — after all
 * guards, so `req.user` is populated — and limits how many report queries a
 * tenant may have in flight at once. A tenant past its budget is rejected with
 * 429 instead of queued, so a runaway report load can never hold more than its
 * plan's allowance of pool connections or CPU.
 *
 * Returns an Observable (never a collapsed value) because it sits inside the
 * global TenantInterceptor/IdempotencyInterceptor chain; yielding a plain value
 * here makes an outer interceptor's mergeMap flatten a non-stream and explode.
 * The slot is released via `finalize`, which fires on completion AND error.
 *
 * In-memory and per-process, which is correct for the single-API-replica
 * topology; move to a Redis-based counter if the API is ever scaled out.
 */
@Injectable()
export class TenantQueryBudgetInterceptor implements NestInterceptor {
  private readonly inFlight = new Map<string, number>();

  constructor(private readonly planService: TenantPlanService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return next.handle();
    }

    const budget = await this.planService.getQueryBudget(tenantId);
    const current = this.inFlight.get(tenantId) ?? 0;
    if (current >= budget) {
      // Thrown from the async interceptor surfaces as a 429 response without
      // ever invoking the handler; no slot was acquired, so none to release.
      throw new ThrottlerException(
        `Tenant report query budget exceeded (max ${budget} concurrent)`,
      );
    }

    this.inFlight.set(tenantId, current + 1);
    return next.handle().pipe(
      finalize(() => {
        const remaining = (this.inFlight.get(tenantId) ?? 1) - 1;
        if (remaining <= 0) {
          this.inFlight.delete(tenantId);
        } else {
          this.inFlight.set(tenantId, remaining);
        }
      }),
    );
  }
}
