import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ArtifactRegistryService } from "../../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../../platform/artifact-revisions.service";

const INVALID_RULE_LITERAL = Symbol("invalid-rule-literal");

@Injectable()
export class BuilderRulesService {
  constructor(private readonly artifacts?: ArtifactRegistryService, private readonly revisions?: ArtifactRevisionsService) {}

  private async mirrorRuleSet(tenantId: string, ruleSet: any) {
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "RULE_SET", artifactId: ruleSet.id, name: ruleSet.name, slug: `rule-set-${ruleSet.id}`, status: ruleSet.status === "ACTIVE" ? "PUBLISHED" : "DRAFT" });
    if (!artifact || !this.revisions) return;
    const rules = await prisma.ruleDefinition.findMany({ where: { tenantId, ruleSetId: ruleSet.id }, orderBy: { priority: "asc" } });
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: ruleSet.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "RULE_SET", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: ruleSet.name, description: ruleSet.description ?? undefined },
      spec: { rules: rules.map((rule: any) => ({ id: rule.id, name: rule.name, description: rule.description ?? undefined, priority: rule.priority, condition: rule.condition, actions: rule.actions ?? [], status: rule.status ?? "ACTIVE" })), settings: ruleSet.settings ?? {}, version: ruleSet.version ?? 0 },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "business_rules", id: ruleSet.id } },
    } });
  }

  async getDecisionTables(
    tenantId: string,
    params: { page?: number; limit?: number; search?: string } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;
    const where: any = { tenantId };
    if (params.search) {
      where.name = { contains: params.search, mode: "insensitive" };
    }
    const [data, total] = await Promise.all([
      prisma.decisionTable.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.decisionTable.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getDecisionTableById(tenantId: string, id: string) {
    const table = await prisma.decisionTable.findFirst({
      where: { id, tenantId },
    });
    if (!table) throw new NotFoundException("Decision table not found");
    return table;
  }

  async createDecisionTable(tenantId: string, dto: any) {
    const existing = await prisma.decisionTable.findFirst({
      where: { tenantId, name: dto.name },
    });
    if (existing)
      throw new BadRequestException(
        "A decision table with this name already exists",
      );

    return prisma.decisionTable.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description || null,
        hitPolicy: dto.hitPolicy || "FIRST",
        inputs: dto.inputs || [],
        outputs: dto.outputs || [],
        rules: dto.rules || [],
        settings: dto.settings || {},
      },
    });
  }

  async updateDecisionTable(tenantId: string, id: string, dto: any) {
    const table = await prisma.decisionTable.findFirst({
      where: { id, tenantId },
    });
    if (!table) throw new NotFoundException("Decision table not found");

    return prisma.decisionTable.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.hitPolicy !== undefined && { hitPolicy: dto.hitPolicy }),
        ...(dto.inputs !== undefined && { inputs: dto.inputs as any }),
        ...(dto.outputs !== undefined && { outputs: dto.outputs as any }),
        ...(dto.rules !== undefined && { rules: dto.rules as any }),
        ...(dto.settings !== undefined && { settings: dto.settings as any }),
      },
    });
  }

  async deleteDecisionTable(tenantId: string, id: string) {
    const table = await prisma.decisionTable.findFirst({
      where: { id, tenantId },
    });
    if (!table) throw new NotFoundException("Decision table not found");
    return prisma.decisionTable.delete({ where: { id } });
  }

  async createRuleSet(tenantId: string, dto: any) {
    const existing = await prisma.ruleSet.findFirst({
      where: { tenantId, name: dto.name },
    });
    if (existing)
      throw new BadRequestException("A rule set with this name already exists");

    const ruleSet = await prisma.ruleSet.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description || null,
        settings: dto.settings || {},
      },
    });
    await this.mirrorRuleSet(tenantId, ruleSet);
    return ruleSet;
  }

  async getRuleSets(tenantId: string) {
    return prisma.ruleSet.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getRuleSetById(tenantId: string, id: string) {
    const rs = await prisma.ruleSet.findFirst({ where: { id, tenantId } });
    if (!rs) throw new NotFoundException("Rule set not found");
    return rs;
  }

  async addRuleToSet(tenantId: string, ruleSetId: string, dto: any) {
    const rs = await prisma.ruleSet.findFirst({
      where: { id: ruleSetId, tenantId },
    });
    if (!rs) throw new NotFoundException("Rule set not found");

    const rule = await prisma.ruleDefinition.create({
      data: {
        tenantId,
        ruleSetId,
        name: dto.name,
        description: dto.description || null,
        priority: dto.priority || 0,
        condition: dto.condition,
        actions: dto.actions || [],
      },
    });
    await this.mirrorRuleSet(tenantId, rs);
    return rule;
  }

  async evaluateRules(tenantId: string, ruleSetId: string, dto: any) {
    const rs = await prisma.ruleSet.findFirst({
      where: { id: ruleSetId, tenantId },
    });
    if (!rs) throw new NotFoundException("Rule set not found");

    const rules = await prisma.ruleDefinition.findMany({
      where: { tenantId, ruleSetId, status: "ACTIVE" },
      orderBy: { priority: "asc" },
    });

    let matched = false;
    let output: unknown = null;

    for (const rule of rules) {
      try {
        const result = this.evaluateCondition(rule.condition, dto.input || {});
        if (result) {
          output = rule.actions;
          matched = true;
          break;
        }
      } catch {
        continue;
      }
    }

    await prisma.ruleEvaluationLog.create({
      data: {
        tenantId,
        ruleSetId,
        input: (dto.input || {}) as any,
        output: (output || {}) as any,
        matched,
        triggeredBy: dto.triggeredBy || null,
      },
    });

    return { matched, output };
  }

  private evaluateCondition(
    condition: string,
    input: Record<string, any>,
  ): boolean {
    // Rules are tenant-authored data, never server-side code. The previous
    // `new Function()` implementation made a condition an arbitrary API
    // process payload. Support only identifier comparisons joined by && / ||;
    // unsupported syntax fails closed and must move to typed expressions.
    const orTerms = condition.split(/\s*\|\|\s*/);
    return orTerms.some((orTerm) => orTerm.split(/\s*&&\s*/).every((term) => this.evaluateComparison(term.trim(), input)));
  }

  private evaluateComparison(term: string, input: Record<string, unknown>): boolean {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/.exec(term);
    if (!match) return false;
    const field = match[1]!;
    const operator = match[2]!;
    const rawRight = match[3]!;
    if (!Object.prototype.hasOwnProperty.call(input, field)) return false;
    const right = this.ruleLiteral(rawRight.trim(), input);
    if (right === INVALID_RULE_LITERAL) return false;
    const left = input[field];
    switch (operator) {
      case "===": return left === right;
      case "!==": return left !== right;
      case "==": return left == right;
      case "!=": return left != right;
      case ">": return typeof left === "number" && typeof right === "number" && left > right;
      case ">=": return typeof left === "number" && typeof right === "number" && left >= right;
      case "<": return typeof left === "number" && typeof right === "number" && left < right;
      case "<=": return typeof left === "number" && typeof right === "number" && left <= right;
      default: return false;
    }
  }

  private ruleLiteral(value: string, input: Record<string, unknown>): unknown {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) return quoted[2];
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && Object.prototype.hasOwnProperty.call(input, value)) return input[value];
    return INVALID_RULE_LITERAL;
  }

  async getRuleAnalytics(tenantId: string) {
    const [totalTables, totalRuleSets, totalRules, totalEvaluations] =
      await Promise.all([
        prisma.decisionTable.count({ where: { tenantId } }),
        prisma.ruleSet.count({ where: { tenantId } }),
        prisma.ruleDefinition.count({ where: { tenantId } }),
        prisma.ruleEvaluationLog.count({ where: { tenantId } }),
      ]);

    return { totalTables, totalRuleSets, totalRules, totalEvaluations };
  }

  async versionRule(tenantId: string, ruleSetId: string) {
    const rs = await prisma.ruleSet.findFirst({
      where: { id: ruleSetId, tenantId },
    });
    if (!rs) throw new NotFoundException("Rule set not found");

    const ruleSet = await prisma.ruleSet.update({
      where: { id: ruleSetId },
      data: { version: (rs.version || 0) + 1 },
    });
    await this.mirrorRuleSet(tenantId, { ...rs, ...ruleSet });
    return ruleSet;
  }
}
