import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ArtifactRegistryService } from "../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../platform/artifact-revisions.service";

/**
 * Builder dashboards: user-authored ERP dashboards (widgets + layout).
 */
@Injectable()
export class BuilderDashboardsService {
  constructor(@Optional() private readonly artifacts?: ArtifactRegistryService, @Optional() private readonly revisions?: ArtifactRevisionsService) {}

  private async mirrorCanonicalDashboard(tenantId: string, dashboard: any) {
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "DASHBOARD", artifactId: dashboard.id, name: dashboard.name, status: dashboard.status, icon: dashboard.icon });
    if (!artifact || !this.revisions) return;
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: dashboard.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "DASHBOARD", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: dashboard.name, description: dashboard.description ?? undefined },
      spec: { widgets: Array.isArray(dashboard.widgets) ? dashboard.widgets : [], layout: dashboard.layout ?? {}, refreshRate: dashboard.refreshRate ?? 300 },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "builder_dashboards", id: dashboard.id } },
    } });
  }
  async getDashboards(tenantId: string) {
    return prisma.builderDashboard.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getDashboardById(tenantId: string, id: string) {
    const db = await prisma.builderDashboard.findFirst({
      where: { id, tenantId },
    });
    if (!db) throw new NotFoundException("Dashboard not found");
    return db;
  }

  async createDashboard(
    tenantId: string,
    dto: {
      name: string;
      description?: string;
      icon?: string;
      widgets?: any;
      layout?: any;
      refreshRate?: number;
    },
  ) {
    const created = await prisma.builderDashboard.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description || null,
        icon: dto.icon || null,
        widgets: dto.widgets || [],
        layout: dto.layout || {},
        refreshRate: dto.refreshRate || 300,
      },
    });
    await this.mirrorCanonicalDashboard(tenantId, created);
    return created;
  }

  async updateDashboard(
    tenantId: string,
    id: string,
    dto: Partial<{
      name: string;
      description: string;
      icon: string;
      status: string;
      widgets: any;
      layout: any;
      refreshRate: number;
    }>,
  ) {
    const db = await prisma.builderDashboard.findFirst({
      where: { id, tenantId },
    });
    if (!db) throw new NotFoundException("Dashboard not found");

    const updated = await prisma.builderDashboard.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.widgets !== undefined && { widgets: dto.widgets }),
        ...(dto.layout !== undefined && { layout: dto.layout }),
        ...(dto.refreshRate !== undefined && { refreshRate: dto.refreshRate }),
      },
    });
    await this.mirrorCanonicalDashboard(tenantId, updated);
    return updated;
  }

  async deleteDashboard(tenantId: string, id: string) {
    const db = await prisma.builderDashboard.findFirst({
      where: { id, tenantId },
    });
    if (!db) throw new NotFoundException("Dashboard not found");
    const deleted = await prisma.builderDashboard.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "DASHBOARD", id);
    return deleted;
  }
}
