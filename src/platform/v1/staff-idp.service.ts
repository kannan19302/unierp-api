/**
 * M32 — multi-provider staff IdP via M03. "A second IdP is added without
 * code change" is this file's own shape: `authenticateStaff()` never
 * imports a specific adapter class, only resolves a provider via M06's
 * routing and calls `execute()` on whichever adapter that resolves to —
 * the same discipline M22's DnsService already established for DNS.
 */
import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, runWithTenantSession } from "@kannan19302/database";
import { parseRolePermissions } from "@kannan19302/shared";
import { idpClient as idpPrisma } from "../../common/idp-client";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { RoutingService } from "../provider-registry/routing.service";
import type { CapabilityAdapter } from "../provider-registry/adapter-contract";
import type { ProviderAdapter } from "../provider-registry/provider-adapter.interface";

const STAFF_IDENTITY_CAPABILITY = "staff.identity";

@Injectable()
export class StaffIdpService {
  constructor(
    private readonly providers: ProviderRegistryService,
    private readonly routing: RoutingService,
  ) {}

  /**
   * Platform controllers opt out of TenantInterceptor by design. Identity and
   * access-package tables still enforce tenant RLS, so provider reads must
   * explicitly establish the authenticated provider realm before querying.
   */
  private withProviderTenant<T>(
    providerTenantId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return runWithTenantSession(
      { tenantId: providerTenantId, userId: "provider-control-plane" },
      operation,
    );
  }

  async registerIdpProvider(providerName: string, adapter: ProviderAdapter & CapabilityAdapter) {
    const provider = await this.providers.registerProvider({ name: providerName });
    await this.providers.bindCapability(provider.id, STAFF_IDENTITY_CAPABILITY);
    this.providers.registerAdapter(provider.id, adapter);
    return provider;
  }

  async authenticateStaff(operatorId: string, nameId: string) {
    const decision = await this.routing.resolve({ tenantId: "platform", capabilityId: STAFF_IDENTITY_CAPABILITY, stickyKey: operatorId });
    const adapter = this.providers.getAdapter(decision.providerId) as CapabilityAdapter | undefined;
    if (!adapter) {
      throw new Error(`Provider ${decision.providerId} was routed to but has no registered adapter`);
    }
    const result = await adapter.execute({ nameId });
    if (!result.success) {
      throw new Error(`Staff authentication failed via provider ${decision.providerId}: ${result.error}`);
    }
    return { providerId: decision.providerId, reason: decision.reason, ...result.output };
  }

  async listPrincipals(providerTenantId: string) {
    return this.withProviderTenant(providerTenantId, async () => {
    const principals = await idpPrisma.user.findMany({
      where: { tenantId: providerTenantId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
        roles: { include: { role: true } },
        _count: { select: { userSessions: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    });

    return principals.map((principal) => ({
      id: principal.id,
      email: principal.email,
      firstName: principal.firstName,
      lastName: principal.lastName,
      status: principal.status,
      mfaEnabled: principal.mfaEnabled,
      lastLoginAt: principal.lastLoginAt,
      activeSessionCount: principal._count.userSessions,
      roles: principal.roles.map(({ role }) => ({ id: role.id, name: role.name })),
    }));
    });
  }

  async listGroups(providerTenantId: string) {
    return this.withProviderTenant(providerTenantId, () => idpPrisma.userGroup.findMany({
      where: { tenantId: providerTenantId },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        _count: { select: { members: true } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }));
  }

  async listRoles(providerTenantId: string) {
    return this.withProviderTenant(providerTenantId, async () => {
    const roles = await idpPrisma.role.findMany({
      where: { tenantId: providerTenantId },
      include: { _count: { select: { users: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      principalCount: role._count.users,
      permissions: parseRolePermissions(role.permissions),
    }));
    });
  }

  async listAccessPackages(providerTenantId: string) {
    return this.withProviderTenant(providerTenantId, async () => {
    const packages = await prisma.accessPackage.findMany({
      where: { tenantId: providerTenantId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const assignments = packages.length
      ? await prisma.roleAccessPackage.findMany({
          where: { accessPackageId: { in: packages.map((pkg) => pkg.id) } },
        })
      : [];

    return packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      isSystem: pkg.isSystem,
      permissions: parseRolePermissions(pkg.permissions),
      roleIds: assignments
        .filter((assignment) => assignment.accessPackageId === pkg.id)
        .map((assignment) => assignment.roleId)
        .sort(),
    }));
    });
  }

  async listServicePrincipals(providerTenantId: string) {
    return this.withProviderTenant(providerTenantId, async () => {
    const [apiKeys, userTokens] = await Promise.all([
      idpPrisma.apiKey.findMany({
        where: { tenantId: providerTenantId },
        select: {
          id: true,
          name: true,
          prefix: true,
          status: true,
          apiScopes: true,
          ipWhitelist: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      idpPrisma.authApiToken.findMany({
        where: { tenantId: providerTenantId },
        select: {
          id: true,
          userId: true,
          name: true,
          scopes: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return [
      ...apiKeys.map((key) => ({
        kind: "API_KEY" as const,
        ...key,
        scopes: key.apiScopes
          ? key.apiScopes.split(",").map((scope) => scope.trim()).filter(Boolean)
          : [],
      })),
      ...userTokens.map((token) => ({
        kind: "USER_TOKEN" as const,
        ...token,
        scopes: parseRolePermissions(token.scopes),
      })),
    ];
    });
  }

  async listSessions(providerTenantId: string) {
    return this.withProviderTenant(providerTenantId, async () => {
    const sessions = await idpPrisma.userSession.findMany({
      where: { tenantId: providerTenantId },
      select: {
        id: true,
        userId: true,
        device: true,
        browser: true,
        ipAddress: true,
        location: true,
        isActive: true,
        startedAt: true,
        lastActivityAt: true,
        expiresAt: true,
        platform: true,
        appVersion: true,
        user: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: { lastActivityAt: "desc" },
    });
    return sessions;
    });
  }

  async getEffectiveAccess(providerTenantId: string, principalId: string) {
    return this.withProviderTenant(providerTenantId, async () => {
    const principal = await idpPrisma.user.findFirst({
      where: { id: principalId, tenantId: providerTenantId, deletedAt: null },
      select: {
        id: true,
        email: true,
        status: true,
        mfaEnabled: true,
        roles: {
          where: { role: { tenantId: providerTenantId } },
          include: { role: true },
        },
      },
    });
    if (!principal) throw new NotFoundException("Provider principal not found");

    const roles = principal.roles
      .map(({ role }) => ({
        id: role.id,
        name: role.name,
        permissions: parseRolePermissions(role.permissions),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const assignments = roles.length
      ? await prisma.roleAccessPackage.findMany({
          where: {
            roleId: { in: roles.map((role) => role.id) },
            accessPackage: { tenantId: providerTenantId },
          },
          include: { accessPackage: true },
        })
      : [];

    const packagesById = new Map<
      string,
      { id: string; name: string; roleIds: Set<string>; permissions: string[] }
    >();
    for (const assignment of assignments) {
      const existing = packagesById.get(assignment.accessPackage.id);
      if (existing) {
        existing.roleIds.add(assignment.roleId);
      } else {
        packagesById.set(assignment.accessPackage.id, {
          id: assignment.accessPackage.id,
          name: assignment.accessPackage.name,
          roleIds: new Set([assignment.roleId]),
          permissions: parseRolePermissions(assignment.accessPackage.permissions),
        });
      }
    }
    const accessPackages = Array.from(packagesById.values())
      .map((pkg) => ({ ...pkg, roleIds: Array.from(pkg.roleIds).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    return {
      principal: {
        id: principal.id,
        email: principal.email,
        status: principal.status,
        mfaEnabled: principal.mfaEnabled,
      },
      roles,
      accessPackages,
      effectivePermissions: Array.from(
        new Set([
          ...roles.flatMap((role) => role.permissions),
          ...accessPackages.flatMap((pkg) => pkg.permissions),
        ]),
      ).sort(),
    };
    });
  }
}
