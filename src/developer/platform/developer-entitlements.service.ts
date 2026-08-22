import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { DEFAULT_GOVERNOR_LIMITS, type GovernorDimension, type GovernorLimitOverrides } from "./project-governor.service";

@Injectable()
export class DeveloperEntitlementsService {
  private readonly db = prisma as any;
  async limits(tenantId: string): Promise<GovernorLimitOverrides> {
    const row = await this.db.tenantDeveloperEntitlement.findFirst({ where: { tenantId, status: "ACTIVE" } });
    return this.normalize(row?.limits);
  }
  async save(tenantId: string, limits: GovernorLimitOverrides, updatedBy?: string | null) {
    const normalized = this.normalize(limits, true);
    return this.db.tenantDeveloperEntitlement.upsert({ where: { tenantId }, create: { tenantId, limits: normalized, updatedBy: updatedBy ?? null }, update: { limits: normalized, status: "ACTIVE", updatedBy: updatedBy ?? null } });
  }
  private normalize(value: unknown, strict = false): GovernorLimitOverrides {
    if (!value || typeof value !== "object" || Array.isArray(value)) { if (strict) throw new BadRequestException("Governor limits must be an object"); return {}; }
    const out: GovernorLimitOverrides = {};
    for (const dimension of Object.keys(DEFAULT_GOVERNOR_LIMITS) as GovernorDimension[]) {
      const candidate = (value as any)[dimension]; if (candidate === undefined) continue;
      if (!candidate || !Number.isSafeInteger(candidate.soft) || !Number.isSafeInteger(candidate.hard) || candidate.soft < 0 || candidate.hard < candidate.soft) { if (strict) throw new BadRequestException(`Invalid governor limits for ${dimension}`); continue; }
      out[dimension] = { soft: candidate.soft, hard: candidate.hard };
    }
    return out;
  }
}
