import { Controller, Get, Post, Body, Param, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { z } from "zod";
import { DevProjectsService } from "./dev-projects.service";

interface AuthenticatedRequest extends Request {
  user: { tenantId: string; userId: string; email: string; roles: string[] };
}

const createAppSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
});

const createSiteSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
});

/**
 * `/api/v1/dev/*` — the developer platform's own home surface, additive to
 * (never replacing) the legacy `/builder/*` routes those two entities were
 * previously only reachable through. See plan phase P1: this is what the
 * frontend home page (`src/app/(platform)/page.tsx`) reads once it stops
 * reading `/builder/modules` and `/builder/web-studio/sites` directly.
 */
@ApiTags("developer-platform")
@ApiBearerAuth()
@Controller("dev")
@UseGuards(JwtAuthGuard, RbacGuard)
export class DevHomeController {
  constructor(private readonly projects: DevProjectsService) {}

  @ApiOperation({ summary: "Developer platform home: every app and site" })
  @Get("home")
  @Permissions("builder.read")
  async home(@Req() req: AuthenticatedRequest) {
    return this.projects.home(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get one project's identity by id, any kind" })
  @Get("projects/:id")
  @Permissions("builder.read")
  async getProject(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.projects.getById(req.user.tenantId, id);
  }

  @ApiOperation({ summary: "Recently opened apps and sites" })
  @Get("recents")
  @Permissions("builder.read")
  async recents(@Req() req: AuthenticatedRequest) {
    return this.projects.recents(req.user.tenantId, req.user.userId);
  }

  @ApiOperation({ summary: "Record that a project was opened" })
  @Post("recents/:projectId")
  @Permissions("builder.read")
  async touchRecent(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.projects.touchRecent(req.user.tenantId, req.user.userId, projectId);
  }

  @ApiOperation({ summary: "Create a new app" })
  @Post("apps")
  @Permissions("builder.module.create")
  async createApp(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createAppSchema) body: z.infer<typeof createAppSchema>,
  ) {
    return this.projects.createApp(req.user.tenantId, req.user.userId, body);
  }

  @ApiOperation({ summary: "Create a new site" })
  @Post("sites")
  @Permissions("builder.create")
  async createSite(
    @Req() req: AuthenticatedRequest,
    @ZodBody(createSiteSchema) body: z.infer<typeof createSiteSchema>,
  ) {
    return this.projects.createSite(req.user.tenantId, req.user.userId, body);
  }
}
