import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  UseGuards,
  Req,
  Param,
  Query,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import { ZodBody } from "../../../common/decorators/zod-body.decorator";
import { Request } from "express";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CloseManagementService } from "../services/close-management.service";
import {
  AssignCloseTaskSlaRequestSchema,
  CloseSlaPolicyListQuerySchema,
  CreateCloseSlaPolicyRequestSchema,
  LegacyCreateCloseSlaPolicyRequestSchema,
  ReviseCloseSlaPolicyRequestSchema,
  RetireCloseSlaPolicyRequestSchema,
} from "@kannan19302/contracts";

interface AuthenticatedRequest extends Request {
  user: {
    tenantId: string;
    userId: string;
    email: string;
    roles: string[];
    orgId?: string;
  };
}

const createTaskDependencySchema = z.object({
  predecessorTaskId: z.string().min(1),
  successorTaskId: z.string().min(1),
  dependencyType: z.string().min(1),
  lagDays: z.number().int().min(0).optional(),
});
const createCalendarEventSchema = z.object({
  periodId: z.string().min(1),
  eventType: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  dueAt: z.string().min(1),
});
const escalationRuleFieldsSchema = z.object({
  name: z.string().trim().min(1).max(255),
  conditionField: z.string().trim().min(1).max(100),
  conditionOperator: z.enum(["EQUALS", "NOT_EQUALS", "GREATER_THAN", "GREATER_THAN_OR_EQUAL"]),
  conditionValue: z.string().trim().min(1).max(500),
  escalateToRole: z.string().trim().min(1).max(255).optional(),
  escalateToUser: z.string().trim().min(1).max(255).optional(),
  notifyMethod: z.enum(["EMAIL", "IN_APP", "BOTH"]).default("EMAIL"),
});
const createEscalationRuleSchema = escalationRuleFieldsSchema.strict().refine(
  (value) => value.escalateToRole || value.escalateToUser,
  { message: "An escalation target role or user is required" },
);
const updateEscalationRuleSchema = escalationRuleFieldsSchema.partial().extend({ isActive: z.boolean().optional() }).strict();
const captureSnapshotSchema = z.object({ periodId: z.string().trim().min(1) }).strict();

@ApiTags("advanced-finance-close-management")
@ApiBearerAuth()
@Controller("advanced-finance/close-management")
@UseGuards(JwtAuthGuard, RbacGuard)
export class CloseManagementController {
  constructor(private readonly cmService: CloseManagementService) {}

  @Post("task-dependencies")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Create task dependency" })
  async createTaskDependency(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createTaskDependencySchema) dto: z.infer<typeof createTaskDependencySchema>,
  ) {
    return this.cmService.createTaskDependency(req.user.tenantId, {
      taskId: dto.successorTaskId,
      dependsOnTaskId: dto.predecessorTaskId,
      dependencyType: dto.dependencyType,
      ...(dto.lagDays !== undefined ? { lagDays: dto.lagDays } : {}),
    });
  }

  @Get("task-dependencies")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "List task dependencies" })
  async listTaskDependencies(
    @Req() req: AuthenticatedRequest,
    @Query("taskId") taskId?: string,
  ) {
    return this.cmService.listTaskDependencies(req.user.tenantId, taskId);
  }

  @Delete("task-dependencies/:id")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Delete task dependency" })
  async deleteTaskDependency(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.cmService.deleteTaskDependency(req.user.tenantId, id);
  }

  @Post("slas")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Create SLA" })
  async createSla(
    @Req() req: AuthenticatedRequest,
    @ZodBody(LegacyCreateCloseSlaPolicyRequestSchema) dto: z.infer<typeof LegacyCreateCloseSlaPolicyRequestSchema>,
  ) {
    if (dto.escalationRules !== undefined) {
      throw new BadRequestException("Legacy escalationRules require explicit migration to escalationRuleIds");
    }
    return this.cmService.createCloseSlaPolicy(req.user.tenantId, req.user.userId, {
      name: dto.name,
      ...(dto.description === undefined ? {} : { description: dto.description }),
      taskType: dto.taskType,
      priority: dto.priority ?? "NORMAL",
      timeBasis: "ELAPSED",
      responseTimeMs: dto.responseTimeHours * 3_600_000,
      resolutionTimeMs: dto.resolutionTimeHours * 3_600_000,
      escalationRuleIds: [],
    });
  }

  @Post("sla-policies")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Create reusable close SLA policy" })
  async createCloseSlaPolicy(@Req() req: AuthenticatedRequest,
    @ZodBody(CreateCloseSlaPolicyRequestSchema) dto: z.infer<typeof CreateCloseSlaPolicyRequestSchema>) {
    return this.cmService.createCloseSlaPolicy(req.user.tenantId, req.user.userId, dto);
  }

  @Get("sla-policies")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "List reusable close SLA policies" })
  async listCloseSlaPolicies(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = CloseSlaPolicyListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException({ message: "Validation failed", errors: parsed.error.errors });
    return this.cmService.listCloseSlaPolicies(req.user.tenantId, parsed.data);
  }

  @Post("sla-policies/:id/versions")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Create immutable close SLA policy revision" })
  async reviseCloseSlaPolicy(@Req() req: AuthenticatedRequest, @Param("id") id: string,
    @ZodBody(ReviseCloseSlaPolicyRequestSchema) dto: z.infer<typeof ReviseCloseSlaPolicyRequestSchema>) {
    return this.cmService.reviseCloseSlaPolicy(req.user.tenantId, req.user.userId, id, dto);
  }

  @Post("sla-policies/:id/retire")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Retire a reusable close SLA policy" })
  async retireCloseSlaPolicy(@Req() req: AuthenticatedRequest, @Param("id") id: string,
    @ZodBody(RetireCloseSlaPolicyRequestSchema) dto: z.infer<typeof RetireCloseSlaPolicyRequestSchema>) {
    return this.cmService.retireCloseSlaPolicy(req.user.tenantId, req.user.userId, id, dto);
  }

  @Post("task-slas")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Assign SLA deadlines to a close task" })
  async assignCloseTaskSla(@Req() req: AuthenticatedRequest,
    @ZodBody(AssignCloseTaskSlaRequestSchema) dto: z.infer<typeof AssignCloseTaskSlaRequestSchema>) {
    return this.cmService.assignCloseTaskSla(req.user.tenantId, dto);
  }

  @Get("slas")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "List SLAs" })
  async listSlas(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("taskId") taskId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.cmService.listSlas(req.user.tenantId, {
      status,
      taskId,
      page,
      limit,
    });
  }

  @Patch("slas/:id/status")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Update SLA status" })
  async updateSlaStatus(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @ZodBody(z.object({ status: z.enum(["ACTIVE", "BREACHED", "RESOLVED"]) }).strict())
    dto: { status: "ACTIVE" | "BREACHED" | "RESOLVED" },
  ) {
    return this.cmService.updateSlaStatus(req.user.tenantId, req.user.userId, id, dto);
  }

  @Get("slas/breached")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "Get breached SLAs" })
  async getBreachedSlas(@Req() req: AuthenticatedRequest) {
    return this.cmService.getBreachedSlas(req.user.tenantId);
  }

  @Post("calendar/events")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Create calendar event" })
  async createCalendarEvent(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createCalendarEventSchema) dto: any,
  ) {
    return this.cmService.createCalendarEvent(req.user.tenantId, dto);
  }

  @Get("calendar/events")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "List calendar events" })
  async listCalendarEvents(
    @Req() req: AuthenticatedRequest,
    @Query("periodId") periodId?: string,
    @Query("eventType") eventType?: string,
  ) {
    return this.cmService.listCalendarEvents(
      req.user.tenantId,
      periodId,
      eventType,
    );
  }

  @Post("calendar/events/:id/complete")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Complete calendar event" })
  async completeCalendarEvent(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.cmService.completeCalendarEvent(req.user.tenantId, id);
  }

  @Get("calendar/period-events/:periodId")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "Get period events" })
  async getPeriodEvents(
    @Req() req: AuthenticatedRequest,
    @Param("periodId") periodId: string,
  ) {
    return this.cmService.getPeriodEvents(req.user.tenantId, periodId);
  }

  @Post("escalation-rules")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Create escalation rule" })
  async createEscalationRule(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createEscalationRuleSchema) dto: z.infer<typeof createEscalationRuleSchema>,
  ) {
    return this.cmService.createEscalationRule(req.user.tenantId, dto);
  }

  @Get("escalation-rules")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "List escalation rules" })
  async listEscalationRules(
    @Req() req: AuthenticatedRequest,
    @Query("isActive") isActive?: string,
  ) {
    return this.cmService.listEscalationRules(
      req.user.tenantId,
      isActive === "true" ? true : isActive === "false" ? false : undefined,
    );
  }

  @Get("escalation-rules/:id")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "Get escalation rule" })
  async getEscalationRule(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.cmService.getEscalationRule(req.user.tenantId, id);
  }

  @Patch("escalation-rules/:id")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Update escalation rule" })
  async updateEscalationRule(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @ZodBody(updateEscalationRuleSchema) dto: z.infer<typeof updateEscalationRuleSchema>,
  ) {
    return this.cmService.updateEscalationRule(req.user.tenantId, id, dto);
  }

  @Delete("escalation-rules/:id")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Delete escalation rule" })
  async deleteEscalationRule(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.cmService.deleteEscalationRule(req.user.tenantId, id);
  }

  @Post("snapshots")
  @Permissions("finance.close.manage")
  @ApiOperation({ summary: "Capture close snapshot" })
  async captureSnapshot(
    @Req() req: AuthenticatedRequest,
    @ZodBody(captureSnapshotSchema) dto: z.infer<typeof captureSnapshotSchema>,
  ) {
    return this.cmService.captureSnapshot(
      req.user.tenantId,
      req.user.userId,
      dto,
    );
  }

  @Get("analytics/:periodId")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "Get period analytics" })
  async getPeriodAnalytics(
    @Req() req: AuthenticatedRequest,
    @Param("periodId") periodId: string,
  ) {
    return this.cmService.getPeriodAnalytics(req.user.tenantId, periodId);
  }

  @Get("trends")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "Get trend data" })
  async getTrendData(@Req() req: AuthenticatedRequest) {
    return this.cmService.getTrendData(req.user.tenantId);
  }

  @Get("status-summary")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "Get close status summary" })
  async getCloseStatusSummary(
    @Req() req: AuthenticatedRequest,
    @Query("periodId") periodId?: string,
  ) {
    return this.cmService.getCloseStatusSummary(req.user.tenantId, periodId);
  }

  @Get("critical-path")
  @Permissions("finance.close.read")
  @ApiOperation({ summary: "Get critical path analysis" })
  async getCriticalPathAnalysis(
    @Req() req: AuthenticatedRequest,
    @Query("periodId") periodId?: string,
  ) {
    return this.cmService.getCriticalPathAnalysis(req.user.tenantId, periodId);
  }
}
