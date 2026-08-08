/**
 * Per-plan limits for the tenant throttler.
 *
 * short      — per-second burst bucket (all API routes)
 * medium     — per-minute budget (all API routes)
 * report     — per-minute budget for reporting-engine endpoints only. Reports
 *              are deliberately tighter than the general medium budget: a
 *              runaway report load is the canonical noisy-neighbour.
 * concurrency— max concurrent in-flight report-engine queries per tenant.
 *              Bounds connection-pool consumption regardless of HTTP rate, so
 *              one tenant's heavy reports cannot starve the pool.
 */
export const FREE_PLAN_LIMITS: Record<string, number> = {
  short: 5,
  medium: 30,
  report: 10,
  concurrency: 1,
};

export const TENANT_PLAN_LIMITS: Record<string, Record<string, number>> = {
  free: FREE_PLAN_LIMITS,
  starter: {
    short: 20,
    medium: 200,
    report: 40,
    concurrency: 2,
  },
  business: {
    short: 50,
    medium: 500,
    report: 100,
    concurrency: 4,
  },
  enterprise: {
    short: 100,
    medium: 1000,
    report: 200,
    concurrency: 8,
  },
};
