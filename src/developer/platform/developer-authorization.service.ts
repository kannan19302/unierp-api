import { ForbiddenException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";

export type DeveloperActor = { userId: string; roles: string[]; type?: "MAKER" | "APPROVER" | "RUNTIME" | "END_USER" };
export type ProjectAction = "AUTHOR" | "RELEASE" | "DEPLOY" | "RUNTIME";

/**
 * Project-scoped ABAC overlay. RBAC guards remain the coarse first gate; when
 * a project has any active `DEV_PROJECT` policy for an action this service
 * becomes authoritative. That permits progressive adoption without silently
 * treating an unconfigured project as public.
 */
@Injectable()
export class DeveloperAuthorizationService {
  private readonly db = prisma as any;

  async assertProjectAction(tenantId: string, projectId: string, actor: DeveloperActor, action: ProjectAction) {
    const rules = await this.db.builderPermissionRule.findMany({
      where: { tenantId, entityType: "DEV_PROJECT", entityId: projectId, ruleType: action, scope: "PROJECT", isActive: true },
    });
    if (!rules.length) return; // inherited tenant RBAC is deliberately retained until a project opts into ABAC.
    const applicable = rules.filter((rule: any) => !rule.userId && !rule.role || rule.userId === actor.userId || (rule.role && actor.roles.includes(rule.role)));
    if (applicable.some((rule: any) => rule.access === "DENY")) throw new ForbiddenException(`Project policy denies ${action.toLowerCase()} access`);
    if (!applicable.some((rule: any) => rule.access === "ALLOW")) throw new ForbiddenException(`Project policy does not grant ${action.toLowerCase()} access`);
  }
}
