import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { buildAppCatalog } from "@/common/app-slug-map";

@Injectable()
export class SaasPortalService {
  async getPlatformOverview() {
    const [tenants, users, apps, revenue] = await Promise.all([
      prisma.tenant.count(),
      idpPrisma.user.count(),
      prisma.marketplaceApp.count(),
      prisma.invoice.aggregate({ _sum: { totalAmount: true } }),
    ]);

    return {
      totalTenants: tenants,
      totalUsers: users,
      totalApps: apps,
      totalRevenue: revenue._sum.totalAmount ?? 0,
    };
  }

  async getInstalledApps(tenantId: string) {
    const installed = await prisma.installedApp.findMany({
      where: { tenantId },
      select: { appId: true, appSlug: true },
    });
    const list = new Set<string>();
    for (const i of installed) {
      if (i.appId) list.add(i.appId);
      if (i.appSlug) list.add(i.appSlug);
    }
    return Array.from(list);
  }

  /**
   * The canonical module/app catalog — same data `entitlement.middleware.ts`
   * gates routes against (module-tiers.ts / app-slug-map.ts), served as JSON
   * so the frontend has one real source instead of the five hand-maintained
   * copies this repo had drifted into (api's own module-tiers.ts, idp's
   * byte-identical copy, tenant-apps' registry.tsx allApplications array, its
   * layout.tsx GLOBAL_SEARCH_ITEMS — not entitlement-filtered at all — and
   * src/modules/index.ts). Those other four still exist; this endpoint is
   * what stops the frontend one from being able to drift further, and is
   * the only one an Application Wizard should ever need to query.
   */
  getAppCatalog() {
    return buildAppCatalog();
  }
}
