import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ProjectPreviewService } from "./project-preview.service";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { RequireIdempotencyKey } from "../../common/idempotency/require-idempotency-key.decorator";
import { z } from "zod";
interface AuthenticatedRequest extends Request { user: { tenantId: string; userId: string } }
const submissionSchema = z.object({ formArtifactId: z.string().min(1).max(200), values: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length <= 64, "At most 64 fields may be submitted") });
@ApiTags("developer-platform-preview") @ApiBearerAuth() @Controller("dev/previews") @UseGuards(JwtAuthGuard, RbacGuard)
export class ProjectPreviewResolveController {
  constructor(private readonly preview: ProjectPreviewService) {}
  @Get(":token") @Permissions("builder.read") resolve(@Req() req: AuthenticatedRequest, @Param("token") token: string) { return this.preview.resolve(req.user.tenantId, token); }
  @Post(":token/submissions") @Permissions("builder.record.create") @RequireIdempotencyKey() submit(@Req() req: AuthenticatedRequest, @Param("token") token: string, @ZodBody(submissionSchema) body: z.infer<typeof submissionSchema>) { return this.preview.submit(req.user.tenantId, token, { ...body, createdBy: req.user.userId }); }
}
