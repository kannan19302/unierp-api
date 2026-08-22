import { Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { RuntimeCellAssignmentService } from "./runtime-cell-assignment.service";

interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string; roles: string[] } }
const relocationSchema = z.object({ cellId: z.string().min(3).max(160), shard: z.number().int().min(0).max(1_000_000), region: z.string().min(2).max(80), topologyVersion: z.string().min(1).max(80) });

@ApiTags("developer-platform-runtime-cells")
@ApiBearerAuth()
@Controller("dev/runtime-cells")
@UseGuards(JwtAuthGuard, RbacGuard)
export class RuntimeCellAssignmentController {
  constructor(private readonly assignments: RuntimeCellAssignmentService) {}

  @Get("placement") @Permissions("builder.manage")
  placement(@Req() req: AuthenticatedRequest) { return this.assignments.placement(req.user.tenantId); }

  @Get("history") @Permissions("builder.manage")
  history(@Req() req: AuthenticatedRequest) { return this.assignments.history(req.user.tenantId); }

  @Post("relocate") @Permissions("builder.manage") @RequireIdempotencyKey()
  @ApiOperation({ summary: "Explicitly relocate this tenant's runtime cell assignment" })
  relocate(@Req() req: AuthenticatedRequest, @ZodBody(relocationSchema) body: z.infer<typeof relocationSchema>) {
    return this.assignments.relocate(req.user.tenantId, body, req.user.userId);
  }
}
