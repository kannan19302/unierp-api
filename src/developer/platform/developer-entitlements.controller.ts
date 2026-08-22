import { Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { DeveloperEntitlementsService } from "./developer-entitlements.service";
import { DeveloperWorkloadMeteringService } from "./developer-workload-metering.service";
interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string } }
const limit = z.object({ soft: z.number().int().nonnegative(), hard: z.number().int().nonnegative() }).refine((value) => value.hard >= value.soft, "hard must be at least soft");
const schema = z.object({ artifacts: limit.optional(), packages: limit.optional(), bindings: limit.optional(), sourceBytes: limit.optional(), previewSessions: limit.optional() });
@ApiTags("developer-platform-governance") @ApiBearerAuth() @Controller("dev/governance") @UseGuards(JwtAuthGuard, RbacGuard)
export class DeveloperEntitlementsController {
  constructor(private readonly entitlements: DeveloperEntitlementsService, private readonly workloads: DeveloperWorkloadMeteringService) {}
  @Get("entitlements") @Permissions("builder.manage") get(@Req() req: AuthenticatedRequest) { return this.entitlements.limits(req.user.tenantId); }
  @Get("workload-usage") @Permissions("builder.manage") usage(@Req() req: AuthenticatedRequest) { return this.workloads.usage(req.user.tenantId); }
  @Post("entitlements") @Permissions("builder.manage") @RequireIdempotencyKey() save(@Req() req: AuthenticatedRequest, @ZodBody(schema) body: z.infer<typeof schema>) { return this.entitlements.save(req.user.tenantId, body, req.user.userId); }
}
