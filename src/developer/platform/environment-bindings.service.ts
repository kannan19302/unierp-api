import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

const SAFE_REFERENCE = /^(vault|service|connector):\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;

/**
 * Environment bindings carry stable vault/service references only. The
 * reference is deliberately validated here so accidental secret literals can
 * never reach a release manifest, audit log, or browser response.
 */
@Injectable()
export class EnvironmentBindingsService {
  private readonly db = prisma as any;

  async list(tenantId: string, projectId: string, environmentId?: string) {
    await this.requireProject(tenantId, projectId);
    return this.db.environmentBinding.findMany({
      where: { tenantId, projectId, ...(environmentId ? { environmentId } : {}) },
      orderBy: [{ environmentId: "asc" }, { key: "asc" }],
    });
  }

  async environmentOptions(tenantId: string, projectId: string) {
    await this.requireProject(tenantId, projectId);
    return this.db.environment.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, name: true, slug: true, type: true },
      orderBy: { name: "asc" },
    });
  }

  async upsert(input: {
    tenantId: string; projectId: string; environmentId: string; key: string; kind: string;
    reference: string; requiredCapabilities?: string[]; createdBy?: string | null;
  }) {
    if (!SAFE_REFERENCE.test(input.reference)) {
      throw new BadRequestException("reference must be a vault://, service://, or connector:// locator; secret values are never accepted");
    }
    await Promise.all([this.requireProject(input.tenantId, input.projectId), this.requireEnvironment(input.tenantId, input.environmentId)]);
    return this.db.environmentBinding.upsert({
      where: { projectId_environmentId_key: { projectId: input.projectId, environmentId: input.environmentId, key: input.key } },
      create: {
        tenantId: input.tenantId, projectId: input.projectId, environmentId: input.environmentId,
        key: input.key, kind: input.kind, reference: input.reference,
        requiredCapabilities: input.requiredCapabilities ?? [], status: "UNVERIFIED", createdBy: input.createdBy ?? null,
      },
      update: { kind: input.kind, reference: input.reference, requiredCapabilities: input.requiredCapabilities ?? [], status: "UNVERIFIED", verifiedAt: null },
    });
  }

  async verify(input: { tenantId: string; projectId: string; environmentId: string; key: string }) {
    const binding = await this.db.environmentBinding.findFirst({ where: { tenantId: input.tenantId, projectId: input.projectId, environmentId: input.environmentId, key: input.key } });
    if (!binding) throw new NotFoundException("Environment binding not found");
    // Connection validation belongs to the vault/connector runtime. This
    // boundary verifies the reference shape and marks its handoff successful.
    if (!SAFE_REFERENCE.test(binding.reference)) throw new BadRequestException("Binding reference is no longer a valid non-secret locator");
    return this.db.environmentBinding.update({ where: { id: binding.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
  }

  async remove(tenantId: string, projectId: string, environmentId: string, key: string) {
    const binding = await this.db.environmentBinding.findFirst({ where: { tenantId, projectId, environmentId, key } });
    if (!binding) throw new NotFoundException("Environment binding not found");
    return this.db.environmentBinding.delete({ where: { id: binding.id } });
  }

  private async requireProject(tenantId: string, id: string) {
    if (!await this.db.devProject.findFirst({ where: { tenantId, id } })) throw new NotFoundException("Project not found");
  }
  private async requireEnvironment(tenantId: string, id: string) {
    if (!await this.db.environment.findFirst({ where: { tenantId, id, status: "ACTIVE" } })) throw new NotFoundException("Active environment not found");
  }
}
