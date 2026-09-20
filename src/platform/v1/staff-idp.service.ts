/**
 * M32 — multi-provider staff IdP via M03. "A second IdP is added without
 * code change" is this file's own shape: `authenticateStaff()` never
 * imports a specific adapter class, only resolves a provider via M06's
 * routing and calls `execute()` on whichever adapter that resolves to —
 * the same discipline M22's DnsService already established for DNS.
 */
import {
  Injectable,
  NotFoundException,
  Optional,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { prisma, runWithTenantSession } from "@kannan19302/database";
import { parseRolePermissions } from "@kannan19302/shared";
import { idpClient as idpPrisma } from "../../common/idp-client";
import { ProviderRegistryService } from "../provider-registry/provider-registry.service";
import { RoutingService } from "../provider-registry/routing.service";
import { ControlPlaneAuditService } from "./control-plane-audit.service";
import { ConsoleGateway } from "./console.gateway";
import type { CapabilityAdapter } from "../provider-registry/adapter-contract";
import type { ProviderAdapter } from "../provider-registry/provider-adapter.interface";
import type {
  CreateStaffPrincipalInput,
  UpdateStaffPrincipalInput,
  StaffPrincipalQueryInput,
  CreateRoleInput,
  UpdateRoleInput,
  RoleQueryInput,
} from "./dto/staff-crud.dto";

const STAFF_IDENTITY_CAPABILITY = "staff.identity";

@Injectable()
export class StaffIdpService {
  constructor(
    private readonly providers: ProviderRegistryService,
    private readonly routing: RoutingService,
    @Optional() private readonly audit?: ControlPlaneAuditService,
    @Optional() private readonly consoleGateway?: ConsoleGateway,
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

  async listPrincipals(providerTenantId: string, query?: StaffPrincipalQueryInput) {
    return this.withProviderTenant(providerTenantId, async () => {
      const page = Math.max(1, Number(query?.page) || 1);
      const pageSize = Math.max(1, Math.min(100, Number(query?.pageSize) || 25));
      const skip = (page - 1) * pageSize;

      const where: Record<string, any> = {
        tenantId: providerTenantId,
        deletedAt: null,
      };

      if (query?.status && query.status !== "all") {
        where.status = query.status.toUpperCase();
      }

      if (query?.search && query.search.trim()) {
        const term = query.search.trim();
        where.OR = [
          { email: { contains: term, mode: "insensitive" } },
          { firstName: { contains: term, mode: "insensitive" } },
          { lastName: { contains: term, mode: "insensitive" } },
        ];
      }

      const sortField = query?.sort || "lastName";
      const sortDir: "asc" | "desc" = query?.dir === "desc" ? "desc" : "asc";
      const orderBy: any = [{ [sortField]: sortDir }, { id: "asc" }];

      const [principals, total] = await Promise.all([
        idpPrisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
            mfaEnabled: true,
            lastLoginAt: true,
            createdAt: true,
            roles: { include: { role: true } },
            _count: { select: { userSessions: true } },
          },
          orderBy,
          skip: query ? skip : undefined,
          take: query ? pageSize : undefined,
        }),
        idpPrisma.user.count({ where }),
      ]);

      const items = principals.map((principal: any) => ({
        id: principal.id,
        email: principal.email,
        firstName: principal.firstName,
        lastName: principal.lastName,
        name: `${principal.firstName || ""} ${principal.lastName || ""}`.trim() || principal.email,
        status: principal.status,
        mfaEnabled: principal.mfaEnabled,
        lastLoginAt: principal.lastLoginAt,
        createdAt: principal.createdAt,
        activeSessionCount: principal._count.userSessions,
        roles: principal.roles.map(({ role }: any) => ({ id: role.id, name: role.name })),
      }));

      return query ? { data: items, total, page, pageSize } : items;
    });
  }

  async getPrincipal(providerTenantId: string, id: string) {
    return this.withProviderTenant(providerTenantId, async () => {
      const principal = await idpPrisma.user.findFirst({
        where: { id, tenantId: providerTenantId, deletedAt: null },
        include: {
          roles: { include: { role: true } },
          userSessions: {
            where: { isActive: true },
            orderBy: { lastActivityAt: "desc" },
            take: 10,
          },
        },
      });

      if (!principal) throw new NotFoundException(`Staff principal "${id}" not found.`);

      return {
        id: principal.id,
        email: principal.email,
        firstName: principal.firstName,
        lastName: principal.lastName,
        name: `${principal.firstName || ""} ${principal.lastName || ""}`.trim() || principal.email,
        status: principal.status,
        mfaEnabled: principal.mfaEnabled,
        lastLoginAt: principal.lastLoginAt,
        createdAt: principal.createdAt,
        roles: (principal.roles ?? []).map(({ role }: any) => ({
          id: role.id,
          name: role.name,
          permissions: parseRolePermissions(role.permissions),
        })),
        activeSessions: principal.userSessions ?? [],
      };
    });
  }

  async createPrincipal(
    providerTenantId: string,
    data: CreateStaffPrincipalInput,
    auditCtx?: { actorId?: string; actorRole?: string; ipAddress?: string; correlationId?: string },
  ) {
    return this.withProviderTenant(providerTenantId, async () => {
      const existing = await idpPrisma.user.findFirst({
        where: { email: data.email, tenantId: providerTenantId, deletedAt: null },
      });
      if (existing) {
        throw new BadRequestException(`A staff user with email "${data.email}" already exists.`);
      }

      const user = await idpPrisma.user.create({
        data: {
          tenantId: providerTenantId,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          status: "ACTIVE",
          mfaEnabled: data.mfaEnabled ?? false,
          passwordHash: "TEMPORARY_INITIAL_HASH",
        },
      });

      if (data.roleIds && data.roleIds.length > 0) {
        await Promise.all(
          data.roleIds.map((roleId) =>
            idpPrisma.userRole.create({
              data: {
                userId: user.id,
                roleId,
              },
            }),
          ),
        );
      }

      if (this.audit && auditCtx?.actorId) {
        await this.audit.record({
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole ?? "SUPER_ADMIN",
          action: "staff.principal.create",
          targetId: user.id,
          details: { email: data.email, roleIds: data.roleIds },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        });
      }

      this.consoleGateway?.server?.emit("domain.update", {
        domain: "access",
        action: "create",
        entity: "principal",
        id: user.id,
      });

      return this.getPrincipal(providerTenantId, user.id);
    });
  }

  async updatePrincipal(
    providerTenantId: string,
    id: string,
    data: UpdateStaffPrincipalInput,
    auditCtx?: { actorId?: string; actorRole?: string; ipAddress?: string; correlationId?: string },
  ) {
    return this.withProviderTenant(providerTenantId, async () => {
      const user = await idpPrisma.user.findFirst({
        where: { id, tenantId: providerTenantId, deletedAt: null },
      });
      if (!user) throw new NotFoundException(`Staff principal "${id}" not found.`);

      const updateData: Record<string, any> = {};
      if (data.firstName !== undefined) updateData.firstName = data.firstName;
      if (data.lastName !== undefined) updateData.lastName = data.lastName;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.mfaEnabled !== undefined) updateData.mfaEnabled = data.mfaEnabled;

      if (Object.keys(updateData).length > 0) {
        await idpPrisma.user.update({
          where: { id },
          data: updateData,
        });
      }

      if (data.roleIds !== undefined) {
        await idpPrisma.userRole.deleteMany({
          where: { userId: id },
        });
        if (data.roleIds.length > 0) {
          await Promise.all(
            data.roleIds.map((roleId) =>
              idpPrisma.userRole.create({
                data: {
                  userId: id,
                  roleId,
                },
              }),
            ),
          );
        }
      }

      if (this.audit && auditCtx?.actorId) {
        await this.audit.record({
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole ?? "SUPER_ADMIN",
          action: "staff.principal.update",
          targetId: id,
          details: { changes: updateData, roleIds: data.roleIds },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        });
      }

      this.consoleGateway?.server?.emit("domain.update", {
        domain: "access",
        action: "update",
        entity: "principal",
        id,
      });

      return this.getPrincipal(providerTenantId, id);
    });
  }

  async deletePrincipal(
    providerTenantId: string,
    id: string,
    auditCtx?: { actorId?: string; actorRole?: string; ipAddress?: string; correlationId?: string },
  ) {
    return this.withProviderTenant(providerTenantId, async () => {
      const user = await idpPrisma.user.findFirst({
        where: { id, tenantId: providerTenantId, deletedAt: null },
      });
      if (!user) throw new NotFoundException(`Staff principal "${id}" not found.`);

      await idpPrisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: "DEACTIVATED",
        },
      });

      // Terminate any active sessions
      await idpPrisma.userSession.updateMany({
        where: { userId: id, tenantId: providerTenantId },
        data: { isActive: false },
      });

      if (this.audit && auditCtx?.actorId) {
        await this.audit.record({
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole ?? "SUPER_ADMIN",
          action: "staff.principal.delete",
          targetId: id,
          details: { email: user.email },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        });
      }

      this.consoleGateway?.server?.emit("domain.update", {
        domain: "access",
        action: "delete",
        entity: "principal",
        id,
      });

      return { success: true, message: `Staff principal "${user.email}" deactivated.` };
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

  async listRoles(providerTenantId: string, query?: RoleQueryInput) {
    return this.withProviderTenant(providerTenantId, async () => {
      const page = Math.max(1, Number(query?.page) || 1);
      const pageSize = Math.max(1, Math.min(100, Number(query?.pageSize) || 25));
      const skip = (page - 1) * pageSize;

      const where: Record<string, any> = { tenantId: providerTenantId };
      if (query?.search && query.search.trim()) {
        const term = query.search.trim();
        where.OR = [
          { name: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
        ];
      }

      const sortField = query?.sort || "name";
      const sortDir: "asc" | "desc" = query?.dir === "desc" ? "desc" : "asc";
      const orderBy: any = [{ [sortField]: sortDir }, { id: "asc" }];

      const [roles, total] = await Promise.all([
        idpPrisma.role.findMany({
          where,
          include: { _count: { select: { users: true } } },
          orderBy,
          skip: query ? skip : undefined,
          take: query ? pageSize : undefined,
        }),
        idpPrisma.role.count({ where }),
      ]);

      const items = roles.map((role: any) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        principalCount: role._count.users,
        permissions: parseRolePermissions(role.permissions),
      }));

      return query ? { data: items, total, page, pageSize } : items;
    });
  }

  async getRole(providerTenantId: string, id: string) {
    return this.withProviderTenant(providerTenantId, async () => {
      const role = await idpPrisma.role.findFirst({
        where: { id, tenantId: providerTenantId },
        include: {
          users: {
            include: {
              user: {
                select: { id: true, email: true, firstName: true, lastName: true, status: true },
              },
            },
          },
        },
      });

      if (!role) throw new NotFoundException(`Role "${id}" not found.`);

      return {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: parseRolePermissions(role.permissions),
        users: role.users.map(({ user }: any) => ({
          id: user.id,
          email: user.email,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          status: user.status,
        })),
        principalCount: role.users.length,
      };
    });
  }

  async createRole(
    providerTenantId: string,
    data: CreateRoleInput,
    auditCtx?: { actorId?: string; actorRole?: string; ipAddress?: string; correlationId?: string },
  ) {
    return this.withProviderTenant(providerTenantId, async () => {
      const role = await idpPrisma.role.create({
        data: {
          tenantId: providerTenantId,
          name: data.name,
          description: data.description ?? "",
          permissions: JSON.stringify(data.permissions),
          isSystem: false,
        },
      });

      if (this.audit && auditCtx?.actorId) {
        await this.audit.record({
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole ?? "SUPER_ADMIN",
          action: "staff.role.create",
          targetId: role.id,
          details: { name: data.name, permissionsCount: data.permissions.length },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        });
      }

      this.consoleGateway?.server?.emit("domain.update", {
        domain: "access",
        action: "create",
        entity: "role",
        id: role.id,
      });

      return {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: parseRolePermissions(role.permissions),
        principalCount: 0,
      };
    });
  }

  async updateRole(
    providerTenantId: string,
    id: string,
    data: UpdateRoleInput,
    auditCtx?: { actorId?: string; actorRole?: string; ipAddress?: string; correlationId?: string },
  ) {
    return this.withProviderTenant(providerTenantId, async () => {
      const role = await idpPrisma.role.findFirst({
        where: { id, tenantId: providerTenantId },
      });
      if (!role) throw new NotFoundException(`Role "${id}" not found.`);
      if (role.isSystem) {
        throw new ForbiddenException("Cannot modify a built-in system role.");
      }

      const updateData: Record<string, any> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.permissions !== undefined) {
        updateData.permissions = JSON.stringify(data.permissions);
      }

      const updated = await idpPrisma.role.update({
        where: { id },
        data: updateData,
      });

      if (this.audit && auditCtx?.actorId) {
        await this.audit.record({
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole ?? "SUPER_ADMIN",
          action: "staff.role.update",
          targetId: id,
          details: updateData,
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        });
      }

      this.consoleGateway?.server?.emit("domain.update", {
        domain: "access",
        action: "update",
        entity: "role",
        id,
      });

      return {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        isSystem: updated.isSystem,
        permissions: parseRolePermissions(updated.permissions),
      };
    });
  }

  async deleteRole(
    providerTenantId: string,
    id: string,
    auditCtx?: { actorId?: string; actorRole?: string; ipAddress?: string; correlationId?: string },
  ) {
    return this.withProviderTenant(providerTenantId, async () => {
      const role = await idpPrisma.role.findFirst({
        where: { id, tenantId: providerTenantId },
        include: { _count: { select: { users: true } } },
      });
      if (!role) throw new NotFoundException(`Role "${id}" not found.`);
      if (role.isSystem) {
        throw new ForbiddenException("Cannot delete a built-in system role.");
      }
      if (role._count.users > 0) {
        throw new BadRequestException(
          `Cannot delete role "${role.name}" because it is currently assigned to ${role._count.users} user(s).`,
        );
      }

      await idpPrisma.role.delete({ where: { id } });

      if (this.audit && auditCtx?.actorId) {
        await this.audit.record({
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole ?? "SUPER_ADMIN",
          action: "staff.role.delete",
          targetId: id,
          details: { name: role.name },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        });
      }

      this.consoleGateway?.server?.emit("domain.update", {
        domain: "access",
        action: "delete",
        entity: "role",
        id,
      });

      return { success: true, message: `Role "${role.name}" deleted.` };
    });
  }

  async revokeSession(
    providerTenantId: string,
    sessionId: string,
    auditCtx?: { actorId?: string; actorRole?: string; ipAddress?: string; correlationId?: string },
  ) {
    return this.withProviderTenant(providerTenantId, async () => {
      const session = await idpPrisma.userSession.findFirst({
        where: { id: sessionId, tenantId: providerTenantId },
      });
      if (!session) throw new NotFoundException(`Session "${sessionId}" not found.`);

      await idpPrisma.userSession.update({
        where: { id: sessionId },
        data: { isActive: false },
      });

      if (this.audit && auditCtx?.actorId) {
        await this.audit.record({
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole ?? "SUPER_ADMIN",
          action: "staff.session.revoke",
          targetId: sessionId,
          details: { userId: session.userId, ipAddress: session.ipAddress },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        });
      }

      this.consoleGateway?.server?.emit("domain.update", {
        domain: "access",
        action: "revoke",
        entity: "session",
        id: sessionId,
      });

      return { success: true, message: "Session revoked." };
    });
  }

  async revokeAllSessions(
    providerTenantId: string,
    userId?: string,
    auditCtx?: { actorId?: string; actorRole?: string; ipAddress?: string; correlationId?: string },
  ) {
    return this.withProviderTenant(providerTenantId, async () => {
      const where: Record<string, any> = { tenantId: providerTenantId, isActive: true };
      if (userId) where.userId = userId;

      const result = await idpPrisma.userSession.updateMany({
        where,
        data: { isActive: false },
      });

      if (this.audit && auditCtx?.actorId) {
        await this.audit.record({
          actorId: auditCtx.actorId,
          actorRole: auditCtx.actorRole ?? "SUPER_ADMIN",
          action: "staff.session.revoke_all",
          details: { userId, count: result.count },
          correlationId: auditCtx.correlationId,
          ipAddress: auditCtx.ipAddress,
        });
      }

      this.consoleGateway?.server?.emit("domain.update", {
        domain: "access",
        action: "revoke_all",
        entity: "session",
      });

      return { success: true, count: result.count, message: `${result.count} session(s) revoked.` };
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
