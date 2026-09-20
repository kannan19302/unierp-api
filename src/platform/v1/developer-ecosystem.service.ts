import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomBytes, createHash } from "crypto";

export interface DeveloperApp {
  id: string;
  clientId: string;
  clientSecret?: string;
  name: string;
  description?: string;
  clientType: "CONFIDENTIAL" | "PUBLIC";
  ownerTenantId?: string;
  ownerTenantName?: string;
  redirectUris: string[];
  allowedScopes: string[];
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  createdAt: string;
  updatedAt: string;
}

export interface RegisterAppDto {
  name: string;
  description?: string;
  clientType?: "CONFIDENTIAL" | "PUBLIC";
  ownerTenantId?: string;
  redirectUris: string[];
  allowedScopes: string[];
}

export interface SandboxEnvironment {
  id: string;
  name: string;
  tenantId: string;
  tenantName: string;
  dataPreset: "MINIMAL" | "FINANCE_SAMPLE" | "FULL_ENTERPRISE_ERP";
  status: "PROVISIONED" | "INITIALIZING" | "EXPIRED" | "TERMINATED";
  expiresAt: string;
  createdAt: string;
  allocatedStorageMb: number;
  activeConnections: number;
}

export interface CreateSandboxDto {
  name: string;
  tenantId: string;
  tenantName?: string;
  dataPreset?: "MINIMAL" | "FINANCE_SAMPLE" | "FULL_ENTERPRISE_ERP";
  ttlDays?: number;
}

export interface SdkPackage {
  id: string;
  name: string;
  language: "TYPESCRIPT" | "PYTHON" | "GO" | "JAVA" | "CSHARP";
  latestVersion: string;
  minApiVersion: string;
  downloadCount: number;
  status: "ACTIVE" | "DEPRECATED" | "SUNSET";
  releaseNotes: string;
  releasedAt: string;
  sunsetAt?: string;
}

export interface PublishSdkDto {
  name: string;
  language: "TYPESCRIPT" | "PYTHON" | "GO" | "JAVA" | "CSHARP";
  version: string;
  minApiVersion?: string;
  releaseNotes: string;
}

@Injectable()
export class PlatformDeveloperEcosystemService {
  private apps: DeveloperApp[] = [
    {
      id: "app-salesforce-sync",
      clientId: "client_sf_sync_prod_992a",
      name: "Salesforce CRM Bi-Directional Connector",
      description: "Syncs customer accounts, opportunities, and enterprise contacts into UniERP CRM.",
      clientType: "CONFIDENTIAL",
      ownerTenantId: "00000000-0000-0000-0000-000000000001",
      ownerTenantName: "Acme Global Corporation",
      redirectUris: ["https://integrations.acme.com/oauth/callback"],
      allowedScopes: ["crm.read", "crm.write", "tenants.read"],
      status: "ACTIVE",
      createdAt: "2026-01-15T08:00:00.000Z",
      updatedAt: "2026-03-01T12:00:00.000Z",
    },
    {
      id: "app-mobile-pos",
      clientId: "client_pos_native_441b",
      name: "Native Tablet POS Terminal Client",
      description: "Public client for offline-first retail checkout counters and barcode scanning.",
      clientType: "PUBLIC",
      ownerTenantId: "tenant-starlight",
      ownerTenantName: "Starlight Financial Inc.",
      redirectUris: ["unierp-pos://oauth/callback"],
      allowedScopes: ["pos.transact", "inventory.read"],
      status: "ACTIVE",
      createdAt: "2026-02-10T10:00:00.000Z",
      updatedAt: "2026-02-10T10:00:00.000Z",
    },
  ];

  private sandboxes: SandboxEnvironment[] = [
    {
      id: "sbx-acme-dev-01",
      name: "Acme Q3 ERP Migration Sandbox",
      tenantId: "00000000-0000-0000-0000-000000000001",
      tenantName: "Acme Global Corporation",
      dataPreset: "FULL_ENTERPRISE_ERP",
      status: "PROVISIONED",
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      createdAt: new Date(Date.now() - 16 * 86400000).toISOString(),
      allocatedStorageMb: 2048,
      activeConnections: 4,
    },
    {
      id: "sbx-starlight-fin",
      name: "FinTech Automated Ledger Sandbox",
      tenantId: "tenant-starlight",
      tenantName: "Starlight Financial Inc.",
      dataPreset: "FINANCE_SAMPLE",
      status: "PROVISIONED",
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      allocatedStorageMb: 512,
      activeConnections: 1,
    },
  ];

  private sdks: SdkPackage[] = [
    {
      id: "sdk-ts",
      name: "@unierp/sdk-typescript",
      language: "TYPESCRIPT",
      latestVersion: "3.4.2",
      minApiVersion: "v1.2",
      downloadCount: 48200,
      status: "ACTIVE",
      releaseNotes: "Adds support for RFC 9745 Deprecation headers, WebSocket telemetry, and IdP PKCE exchange.",
      releasedAt: "2026-03-10T00:00:00.000Z",
    },
    {
      id: "sdk-py",
      name: "unierp-python",
      language: "PYTHON",
      latestVersion: "2.8.0",
      minApiVersion: "v1.1",
      downloadCount: 31500,
      status: "ACTIVE",
      releaseNotes: "Asyncio streaming client with automatic token rotation and rate-limit backoff.",
      releasedAt: "2026-02-28T00:00:00.000Z",
    },
    {
      id: "sdk-go",
      name: "github.com/unierp/unierp-go",
      language: "GO",
      latestVersion: "1.9.1",
      minApiVersion: "v1.0",
      downloadCount: 19800,
      status: "ACTIVE",
      releaseNotes: "High-performance gRPC + HTTP/2 client for Kubernetes sidecars.",
      releasedAt: "2026-01-20T00:00:00.000Z",
    },
    {
      id: "sdk-java",
      name: "com.unierp:unierp-java-sdk",
      language: "JAVA",
      latestVersion: "1.4.0",
      minApiVersion: "v1.0",
      downloadCount: 8400,
      status: "DEPRECATED",
      releaseNotes: "Legacy Spring Boot 2.x starter. Scheduled for sunset in favor of Jakarta EE 10.",
      releasedAt: "2025-11-15T00:00:00.000Z",
      sunsetAt: "2026-12-31T23:59:59.000Z",
    },
  ];

  // --- 1. Developer App Registration (EC-14.1) ---

  async getApps(search?: string, status?: string): Promise<DeveloperApp[]> {
    return this.apps.filter((app) => {
      const matchSearch =
        !search ||
        app.name.toLowerCase().includes(search.toLowerCase()) ||
        app.clientId.toLowerCase().includes(search.toLowerCase()) ||
        (app.ownerTenantName && app.ownerTenantName.toLowerCase().includes(search.toLowerCase()));
      const matchStatus = !status || status === "ALL" || app.status === status;
      return matchSearch && matchStatus;
    });
  }

  async registerApp(dto: RegisterAppDto): Promise<DeveloperApp> {
    if (!dto.name || dto.name.trim().length < 3) {
      throw new BadRequestException("Application name must be at least 3 characters");
    }

    const rawId = randomBytes(8).toString("hex");
    const clientId = `client_${rawId}`;
    const rawSecret = randomBytes(24).toString("hex");
    const clientSecret = `secret_${rawSecret}`;

    const app: DeveloperApp = {
      id: `app-${rawId}`,
      clientId,
      clientSecret, // Plaintext returned ONLY during registration
      name: dto.name,
      description: dto.description || "",
      clientType: dto.clientType || "CONFIDENTIAL",
      ownerTenantId: dto.ownerTenantId || "00000000-0000-0000-0000-000000000001",
      ownerTenantName: dto.ownerTenantId === "tenant-starlight" ? "Starlight Financial Inc." : "Acme Global Corporation",
      redirectUris: dto.redirectUris?.length ? dto.redirectUris : ["https://localhost:3000/callback"],
      allowedScopes: dto.allowedScopes?.length ? dto.allowedScopes : ["api.read"],
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.apps.unshift(app);
    return app;
  }

  async rotateSecret(appId: string): Promise<{ clientId: string; newClientSecret: string }> {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) throw new NotFoundException(`Developer app ${appId} not found`);

    const rawSecret = randomBytes(24).toString("hex");
    const newClientSecret = `secret_${rawSecret}`;
    app.updatedAt = new Date().toISOString();

    return {
      clientId: app.clientId,
      newClientSecret,
    };
  }

  async deleteApp(appId: string): Promise<{ success: boolean; id: string }> {
    const idx = this.apps.findIndex((a) => a.id === appId);
    if (idx === -1) throw new NotFoundException(`Developer app ${appId} not found`);

    this.apps.splice(idx, 1);
    return { success: true, id: appId };
  }

  // --- 2. Sandbox Management (EC-14.2) ---

  async getSandboxes(): Promise<SandboxEnvironment[]> {
    return this.sandboxes;
  }

  async createSandbox(dto: CreateSandboxDto): Promise<SandboxEnvironment> {
    if (!dto.name) throw new BadRequestException("Sandbox name is required");

    const ttlDays = dto.ttlDays || 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 86400000).toISOString();

    const sbx: SandboxEnvironment = {
      id: `sbx-${Date.now()}`,
      name: dto.name,
      tenantId: dto.tenantId,
      tenantName: dto.tenantName || (dto.tenantId.includes("starlight") ? "Starlight Financial Inc." : "Acme Global Corporation"),
      dataPreset: dto.dataPreset || "FINANCE_SAMPLE",
      status: "PROVISIONED",
      expiresAt,
      createdAt: now.toISOString(),
      allocatedStorageMb: dto.dataPreset === "FULL_ENTERPRISE_ERP" ? 2048 : 512,
      activeConnections: 1,
    };

    this.sandboxes.unshift(sbx);
    return sbx;
  }

  async extendSandbox(id: string, days: number): Promise<SandboxEnvironment> {
    const sbx = this.sandboxes.find((s) => s.id === id);
    if (!sbx) throw new NotFoundException(`Sandbox environment ${id} not found`);

    const currentExpiry = new Date(sbx.expiresAt).getTime();
    const addDays = Number(days) || 14;
    sbx.expiresAt = new Date(currentExpiry + addDays * 86400000).toISOString();
    sbx.status = "PROVISIONED";

    return sbx;
  }

  async destroySandbox(id: string): Promise<{ success: boolean; id: string }> {
    const idx = this.sandboxes.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Sandbox environment ${id} not found`);

    this.sandboxes.splice(idx, 1);
    return { success: true, id };
  }

  // --- 3. SDK Release Management (EC-14.3) ---

  async getSdks(): Promise<SdkPackage[]> {
    return this.sdks;
  }

  async publishSdkRelease(dto: PublishSdkDto): Promise<SdkPackage> {
    if (!dto.name || !dto.version) {
      throw new BadRequestException("SDK package name and version are required");
    }

    let sdk = this.sdks.find((s) => s.name === dto.name || s.language === dto.language);
    if (!sdk) {
      sdk = {
        id: `sdk-${Date.now()}`,
        name: dto.name,
        language: dto.language,
        latestVersion: dto.version,
        minApiVersion: dto.minApiVersion || "v1.0",
        downloadCount: 0,
        status: "ACTIVE",
        releaseNotes: dto.releaseNotes || "Initial release.",
        releasedAt: new Date().toISOString(),
      };
      this.sdks.push(sdk);
    } else {
      sdk.latestVersion = dto.version;
      sdk.releaseNotes = dto.releaseNotes;
      sdk.releasedAt = new Date().toISOString();
      sdk.status = "ACTIVE";
      if (dto.minApiVersion) sdk.minApiVersion = dto.minApiVersion;
    }

    return sdk;
  }

  async deprecateSdk(id: string, sunsetDays?: number): Promise<SdkPackage> {
    const sdk = this.sdks.find((s) => s.id === id);
    if (!sdk) throw new NotFoundException(`SDK package ${id} not found`);

    const days = sunsetDays || 90;
    sdk.status = "DEPRECATED";
    sdk.sunsetAt = new Date(Date.now() + days * 86400000).toISOString();

    return sdk;
  }
}
