import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { createHmac } from "crypto";

export interface LicensePool {
  id: string;
  name: string;
  moduleCode: string;
  totalSeats: number;
  allocatedSeats: number;
  availableSeats: number;
  utilizationPct: number;
  tier: "STANDARD" | "PREMIUM" | "ENTERPRISE";
}

export interface TenantGrantRow {
  tenantId: string;
  tenantName: string;
  planTier: string;
  modules: Record<string, { enabled: boolean; effectiveDate?: string }>;
}

export interface OfflineLicense {
  id: string;
  licenseKey: string;
  tenantId: string;
  tenantName: string;
  allowedModules: string[];
  maxSeats: number;
  issuedAt: string;
  expiresAt: string;
  machineFingerprint?: string;
  signature: string;
}

export interface GenerateOfflineLicenseDto {
  tenantId: string;
  tenantName: string;
  allowedModules: string[];
  maxSeats: number;
  validDays?: number;
  machineFingerprint?: string;
}

const LICENSE_HMAC_SECRET = process.env.LICENSE_HMAC_SECRET || "unierp-enterprise-airgap-secret-key-2026";

@Injectable()
export class PlatformEntitlementsService {
  private pools: LicensePool[] = [
    {
      id: "pool-core-erp",
      name: "Core ERP Standard Enterprise Seats",
      moduleCode: "core-erp",
      totalSeats: 5000,
      allocatedSeats: 3850,
      availableSeats: 1150,
      utilizationPct: 77,
      tier: "ENTERPRISE",
    },
    {
      id: "pool-ai-copilot",
      name: "AI Autonomous Agents & LLM Copilot",
      moduleCode: "ai-copilot",
      totalSeats: 2000,
      allocatedSeats: 1420,
      availableSeats: 580,
      utilizationPct: 71,
      tier: "ENTERPRISE",
    },
    {
      id: "pool-finance-ledger",
      name: "Multi-Currency Financial Ledger & Tax",
      moduleCode: "finance-ledger",
      totalSeats: 3000,
      allocatedSeats: 2100,
      availableSeats: 900,
      utilizationPct: 70,
      tier: "PREMIUM",
    },
    {
      id: "pool-b2b-portal",
      name: "External B2B Vendor & Customer Portal",
      moduleCode: "b2b-portal",
      totalSeats: 10000,
      allocatedSeats: 4800,
      availableSeats: 5200,
      utilizationPct: 48,
      tier: "STANDARD",
    },
  ];

  private grantMatrix: TenantGrantRow[] = [
    {
      tenantId: "00000000-0000-0000-0000-000000000001",
      tenantName: "Acme Global Corporation",
      planTier: "Enterprise",
      modules: {
        "core-erp": { enabled: true, effectiveDate: "2026-01-01" },
        "finance-ledger": { enabled: true, effectiveDate: "2026-01-01" },
        "crm-sales": { enabled: true, effectiveDate: "2026-01-01" },
        "inventory-scm": { enabled: true, effectiveDate: "2026-01-01" },
        "ai-copilot": { enabled: true, effectiveDate: "2026-02-15" },
        "hr-workforce": { enabled: true, effectiveDate: "2026-01-01" },
        "b2b-portal": { enabled: true, effectiveDate: "2026-03-01" },
      },
    },
    {
      tenantId: "tenant-starlight",
      tenantName: "Starlight Financial Inc.",
      planTier: "Enterprise FinTech",
      modules: {
        "core-erp": { enabled: true, effectiveDate: "2026-02-01" },
        "finance-ledger": { enabled: true, effectiveDate: "2026-02-01" },
        "crm-sales": { enabled: true, effectiveDate: "2026-02-01" },
        "inventory-scm": { enabled: false },
        "ai-copilot": { enabled: true, effectiveDate: "2026-03-01" },
        "hr-workforce": { enabled: false },
        "b2b-portal": { enabled: true, effectiveDate: "2026-02-15" },
      },
    },
    {
      tenantId: "tenant-nexus",
      tenantName: "Nexus Cloud Systems",
      planTier: "Mid-Market Growth",
      modules: {
        "core-erp": { enabled: true, effectiveDate: "2026-03-01" },
        "finance-ledger": { enabled: false },
        "crm-sales": { enabled: true, effectiveDate: "2026-03-01" },
        "inventory-scm": { enabled: true, effectiveDate: "2026-03-01" },
        "ai-copilot": { enabled: false },
        "hr-workforce": { enabled: false },
        "b2b-portal": { enabled: false },
      },
    },
  ];

  private offlineLicenses: OfflineLicense[] = [
    {
      id: "lic-airgap-001",
      licenseKey: "UNIERP-ENT-AG1-E3B0C44298FC",
      tenantId: "00000000-0000-0000-0000-000000000001",
      tenantName: "Acme Global Corporation (Air-Gapped GovCloud)",
      allowedModules: ["core-erp", "finance-ledger", "ai-copilot", "inventory-scm"],
      maxSeats: 500,
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      machineFingerprint: "SHA256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
      signature: "hmac-sha256-sig-992a",
    },
  ];

  // --- 1. License Pool Management (EC-05.1) ---

  async getPools(): Promise<LicensePool[]> {
    return this.pools;
  }

  async createPool(dto: Partial<LicensePool>): Promise<LicensePool> {
    const total = Number(dto.totalSeats) || 1000;
    const allocated = Number(dto.allocatedSeats) || 0;
    const pool: LicensePool = {
      id: dto.id || `pool-${Date.now()}`,
      name: dto.name || "Custom License Pool",
      moduleCode: dto.moduleCode || "core-erp",
      totalSeats: total,
      allocatedSeats: allocated,
      availableSeats: Math.max(0, total - allocated),
      utilizationPct: Math.round((allocated / total) * 100),
      tier: dto.tier || "ENTERPRISE",
    };
    this.pools.push(pool);
    return pool;
  }

  async allocateSeats(poolId: string, tenantId: string, seatCount: number): Promise<LicensePool> {
    const pool = this.pools.find((p) => p.id === poolId);
    if (!pool) throw new NotFoundException(`License pool ${poolId} not found`);

    const seats = Number(seatCount);
    if (pool.allocatedSeats + seats > pool.totalSeats) {
      throw new BadRequestException(`Insufficient seats in pool ${pool.name}. Available: ${pool.availableSeats}`);
    }

    pool.allocatedSeats += seats;
    pool.availableSeats = Math.max(0, pool.totalSeats - pool.allocatedSeats);
    pool.utilizationPct = Math.round((pool.allocatedSeats / pool.totalSeats) * 100);

    return pool;
  }

  // --- 2. Module Grant Matrix (EC-05.2) ---

  async getGrantMatrix(): Promise<TenantGrantRow[]> {
    return this.grantMatrix;
  }

  async toggleModuleGrant(tenantId: string, moduleCode: string, enabled: boolean, effectiveDate?: string) {
    let row = this.grantMatrix.find((r) => r.tenantId === tenantId);
    if (!row) {
      row = {
        tenantId,
        tenantName: tenantId,
        planTier: "Standard",
        modules: {},
      };
      this.grantMatrix.push(row);
    }

    row.modules[moduleCode] = {
      enabled,
      effectiveDate: enabled ? (effectiveDate || new Date().toISOString()) : undefined,
    };

    return row;
  }

  async bulkToggle(moduleCode: string, enabled: boolean) {
    for (const row of this.grantMatrix) {
      row.modules[moduleCode] = {
        enabled,
        effectiveDate: enabled ? new Date().toISOString() : undefined,
      };
    }
    return { success: true, moduleCode, enabled, affectedTenants: this.grantMatrix.length };
  }

  // --- 3. Offline Cryptographic License Generator (EC-05.3) ---

  async generateOfflineLicense(dto: GenerateOfflineLicenseDto): Promise<OfflineLicense> {
    const validDays = Number(dto.validDays) || 365;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + validDays * 86400000);

    const payload = {
      tenantId: dto.tenantId,
      tenantName: dto.tenantName,
      allowedModules: dto.allowedModules || ["core-erp"],
      maxSeats: Number(dto.maxSeats) || 100,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      machineFingerprint: dto.machineFingerprint || "ANY",
    };

    const signature = createHmac("sha256", LICENSE_HMAC_SECRET)
      .update(JSON.stringify(payload))
      .digest("hex");

    const rawKey = Buffer.from(JSON.stringify({ ...payload, signature })).toString("base64");
    const formattedKey = `UNIERP-LIC-${rawKey.slice(0, 8)}-${rawKey.slice(8, 16)}-${rawKey.slice(16, 24)}`.toUpperCase();

    const license: OfflineLicense = {
      id: `lic-${Date.now()}`,
      licenseKey: formattedKey,
      tenantId: dto.tenantId,
      tenantName: dto.tenantName,
      allowedModules: payload.allowedModules,
      maxSeats: payload.maxSeats,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      machineFingerprint: payload.machineFingerprint,
      signature,
    };

    this.offlineLicenses.unshift(license);
    return license;
  }

  async getOfflineLicenses(): Promise<OfflineLicense[]> {
    return this.offlineLicenses;
  }

  async getActiveGrants() {
    return this.grantMatrix.flatMap((r) =>
      Object.entries(r.modules)
        .filter(([_, m]) => m.enabled)
        .map(([code, m]) => ({
          id: `grant-${r.tenantId}-${code}`,
          tenantId: r.tenantId,
          tenantName: r.tenantName,
          moduleCode: code,
          tier: r.planTier,
          status: "ACTIVE",
          signedAt: m.effectiveDate,
        }))
    );
  }
}
