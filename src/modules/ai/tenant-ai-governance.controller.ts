import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import {
  TenantAiGovernanceService,
  type TenantAiBudget,
} from "./tenant-ai-governance.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

@ApiTags("tenant-admin")
@ApiBearerAuth()
@Controller("api/v1/ai-governance")
@UseGuards(JwtAuthGuard, RbacGuard)
export class TenantAiGovernanceController {
  constructor(private readonly aiGovernance: TenantAiGovernanceService) {}

  @ApiOperation({ summary: "Get tenant AI governance overview & active agents" })
  @Get("dashboard")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async getDashboard(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.getDashboard(tenantId);
  }

  @ApiOperation({ summary: "List organization AI agents" })
  @Get("agents")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async listAgents(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.listAgents(tenantId);
  }

  @ApiOperation({ summary: "Create new tenant AI agent" })
  @Post("agents")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async createAgent(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      name: string;
      code: string;
      description: string;
      model: string;
      temperature: number;
      systemPrompt: string;
      toolsBound: string[];
      knowledgeSourcesBound: string[];
      allowedRoles: string[];
    },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.createAgent(tenantId, body);
  }

  @ApiOperation({ summary: "Toggle AI agent active status" })
  @Post("agents/:id/toggle")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async toggleAgent(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.toggleAgent(tenantId, id, body.enabled);
  }

  @ApiOperation({ summary: "List RAG knowledge sources" })
  @Get("knowledge-sources")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async listKnowledgeSources(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.listKnowledgeSources(tenantId);
  }

  @ApiOperation({ summary: "Attach new knowledge source to tenant AI" })
  @Post("knowledge-sources")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async attachKnowledgeSource(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      name: string;
      type: "DOCUMENT" | "DATABASE_SCHEMA" | "API_CATALOG" | "POLICY_MANUAL";
      documentCount?: number;
      totalChunks?: number;
    },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.attachKnowledgeSource(tenantId, body);
  }

  @ApiOperation({ summary: "List AI evaluation benchmark results" })
  @Get("evaluations")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async listEvaluations(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.listEvaluations(tenantId);
  }

  @ApiOperation({ summary: "Trigger automated AI agent evaluation run" })
  @Post("evaluations/run")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async runEvaluation(
    @Req() req: AuthenticatedRequest,
    @Body() body: { agentId: string },
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.runEvaluation(tenantId, body.agentId);
  }

  @ApiOperation({ summary: "Get AI monthly budget & token consumption" })
  @Get("budget")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async getBudget(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.getBudget(tenantId);
  }

  @ApiOperation({ summary: "Update AI monthly token ceiling and threshold" })
  @Put("budget")
  @Permissions("occ.ai-governance.access", "ai.admin.manage")
  async updateBudget(
    @Req() req: AuthenticatedRequest,
    @Body() body: Partial<TenantAiBudget>,
  ) {
    const tenantId = req.user?.tenantId || "default-tenant";
    return this.aiGovernance.updateBudget(tenantId, body);
  }
}
