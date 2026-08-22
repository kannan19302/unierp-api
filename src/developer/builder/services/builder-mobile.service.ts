import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ArtifactRegistryService } from "../../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../../platform/artifact-revisions.service";

@Injectable()
export class BuilderMobileService {
  constructor(private readonly artifacts?: ArtifactRegistryService, private readonly revisions?: ArtifactRevisionsService) {}

  private async mirrorApp(tenantId: string, app: any) {
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "MOBILE_APP", artifactId: app.id, name: app.name, slug: app.slug, status: app.status === "ACTIVE" ? "PUBLISHED" : "DRAFT" });
    if (!artifact || !this.revisions) return;
    const [screens, notifications] = await Promise.all([
      prisma.mobileScreen.findMany({ where: { tenantId, appId: app.id }, orderBy: { order: "asc" } }),
      prisma.mobileNotificationConfig.findFirst({ where: { tenantId, appId: app.id } }),
    ]);
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: app.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "MOBILE_APP", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: app.name, description: app.description ?? undefined },
      spec: { platform: app.platform, appConfig: app.appConfig ?? {}, theme: app.theme ?? {}, capabilities: app.capabilities ?? [], settings: app.settings ?? {}, screens: screens.map((screen: any) => ({ id: screen.id, name: screen.name, type: screen.type, components: screen.components ?? [], layout: screen.layout ?? {}, settings: screen.settings ?? {}, order: screen.order })), notification: notifications ? { provider: notifications.provider, enabled: notifications.enabled, templates: notifications.templates ?? [], topics: notifications.topics ?? [], settings: notifications.settings ?? {} } : null },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "mobile_apps", id: app.id } },
    } });
  }

  private async mirrorCurrentApp(tenantId: string, appId: string) {
    if (!this.artifacts || !this.revisions) return;
    const app = await prisma.mobileApp.findFirst({ where: { id: appId, tenantId } });
    if (app) await this.mirrorApp(tenantId, app);
  }

  async getMobileApps(tenantId: string) {
    return prisma.mobileApp.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getMobileAppById(tenantId: string, id: string) {
    const app = await prisma.mobileApp.findFirst({ where: { id, tenantId } });
    if (!app) throw new NotFoundException("Mobile app not found");
    return app;
  }

  async createMobileApp(tenantId: string, dto: any) {
    const existing = await prisma.mobileApp.findFirst({
      where: { tenantId, slug: dto.slug },
    });
    if (existing)
      throw new BadRequestException(
        "A mobile app with this slug already exists",
      );

    const app = await prisma.mobileApp.create({
      data: {
        tenantId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description || null,
        icon: dto.icon || null,
        platform: dto.platform || "BOTH",
        appConfig: dto.appConfig || {},
        theme: dto.theme || {},
        capabilities: dto.capabilities || [],
        settings: dto.settings || {},
      },
    });
    await this.mirrorApp(tenantId, app);
    return app;
  }

  async updateMobileApp(tenantId: string, id: string, dto: any) {
    const app = await prisma.mobileApp.findFirst({ where: { id, tenantId } });
    if (!app) throw new NotFoundException("Mobile app not found");

    const updated = await prisma.mobileApp.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.platform !== undefined && { platform: dto.platform }),
        ...(dto.appConfig !== undefined && { appConfig: dto.appConfig as any }),
        ...(dto.theme !== undefined && { theme: dto.theme as any }),
        ...(dto.capabilities !== undefined && {
          capabilities: dto.capabilities as any,
        }),
        ...(dto.settings !== undefined && { settings: dto.settings as any }),
      },
    });
    await this.mirrorApp(tenantId, updated);
    return updated;
  }

  async deleteMobileApp(tenantId: string, id: string) {
    const app = await prisma.mobileApp.findFirst({ where: { id, tenantId } });
    if (!app) throw new NotFoundException("Mobile app not found");
    const deleted = await prisma.mobileApp.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "MOBILE_APP", id);
    return deleted;
  }

  async addMobileScreen(tenantId: string, appId: string, dto: any) {
    const app = await prisma.mobileApp.findFirst({
      where: { id: appId, tenantId },
    });
    if (!app) throw new NotFoundException("Mobile app not found");

    const screen = await prisma.mobileScreen.create({
      data: {
        tenantId,
        appId,
        name: dto.name,
        type: dto.type || "FORM",
        components: dto.components || [],
        layout: dto.layout || {},
        settings: dto.settings || {},
        order: dto.order || 0,
      },
    });
    await this.mirrorApp(tenantId, app);
    return screen;
  }

  async getMobileScreens(tenantId: string, appId: string) {
    return prisma.mobileScreen.findMany({
      where: { tenantId, appId },
      orderBy: { order: "asc" },
    });
  }

  async updateMobileScreen(tenantId: string, screenId: string, dto: any) {
    const screen = await prisma.mobileScreen.findFirst({
      where: { id: screenId, tenantId },
    });
    if (!screen) throw new NotFoundException("Mobile screen not found");

    const updated = await prisma.mobileScreen.update({
      where: { id: screenId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.components !== undefined && {
          components: dto.components as any,
        }),
        ...(dto.layout !== undefined && { layout: dto.layout as any }),
        ...(dto.settings !== undefined && { settings: dto.settings as any }),
      },
    });
    await this.mirrorCurrentApp(tenantId, screen.appId);
    return updated;
  }

  async deleteMobileScreen(tenantId: string, screenId: string) {
    const screen = await prisma.mobileScreen.findFirst({
      where: { id: screenId, tenantId },
    });
    if (!screen) throw new NotFoundException("Mobile screen not found");
    const deleted = await prisma.mobileScreen.delete({ where: { id: screenId } });
    await this.mirrorCurrentApp(tenantId, screen.appId);
    return deleted;
  }

  async configurePushNotifications(tenantId: string, appId: string, dto: any) {
    const app = await prisma.mobileApp.findFirst({
      where: { id: appId, tenantId },
    });
    if (!app) throw new NotFoundException("Mobile app not found");

    const existing = await prisma.mobileNotificationConfig.findFirst({
      where: { tenantId, appId },
    });
    if (existing) {
      const notification = await prisma.mobileNotificationConfig.update({
        where: { id: existing.id },
        data: {
          provider: dto.provider || existing.provider,
          credentials: dto.credentials || existing.credentials,
          enabled: dto.enabled ?? existing.enabled,
          templates: dto.templates || existing.templates,
          topics: dto.topics || existing.topics,
          settings: dto.settings || existing.settings,
        },
      });
      await this.mirrorApp(tenantId, app);
      return notification;
    }

    const notification = await prisma.mobileNotificationConfig.create({
      data: {
        tenantId,
        appId,
        provider: dto.provider || "FCM",
        credentials: dto.credentials || {},
        enabled: dto.enabled ?? true,
        templates: dto.templates || [],
        topics: dto.topics || [],
        settings: dto.settings || {},
      },
    });
    await this.mirrorApp(tenantId, app);
    return notification;
  }

  async getPushConfig(tenantId: string, appId: string) {
    return prisma.mobileNotificationConfig.findFirst({
      where: { tenantId, appId },
    });
  }

  async previewMobileApp(tenantId: string, appId: string) {
    const app = await prisma.mobileApp.findFirst({
      where: { id: appId, tenantId },
    });
    if (!app) throw new NotFoundException("Mobile app not found");

    const screens = await prisma.mobileScreen.findMany({
      where: { tenantId, appId },
      orderBy: { order: "asc" },
    });

    return {
      app,
      screens,
      preview: {
        platform: app.platform,
        screenCount: screens.length,
        capabilities: app.capabilities,
      },
    };
  }

  async deployMobileBuild(tenantId: string, appId: string, dto: any) {
    const app = await prisma.mobileApp.findFirst({
      where: { id: appId, tenantId },
    });
    if (!app) throw new NotFoundException("Mobile app not found");

    const newBuildNumber = (app.buildNumber || 0) + 1;

    await prisma.mobileApp.update({
      where: { id: appId },
      data: { status: "BUILDING", buildNumber: newBuildNumber },
    });

    const build = await prisma.mobileBuild.create({
      data: {
        tenantId,
        appId,
        platform: dto.platform || "BOTH",
        version: dto.version || app.version,
        buildNumber: newBuildNumber,
        triggeredBy: dto.triggeredBy || null,
        status: "QUEUED",
      },
    });

    return build;
  }

  async getMobileBuilds(tenantId: string, appId: string) {
    return prisma.mobileBuild.findMany({
      where: { tenantId, appId },
      orderBy: { createdAt: "desc" },
    });
  }
}
