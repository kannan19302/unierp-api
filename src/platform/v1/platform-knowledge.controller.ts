import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from "../../common/guards/control-plane.guard";
import { SkipTenantScope } from "../../common/decorators/skip-tenant-scope.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { PlatformKnowledgeService, LearningModuleType } from "./platform-knowledge.service";

@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform/v1/knowledge")
@SkipTenantScope()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
export class PlatformKnowledgeController {
  constructor(private readonly knowledge: PlatformKnowledgeService) {}

  @Get("articles")
  @Permissions("system.knowledge.read")
  @ApiOperation({ summary: "List knowledge base articles and SOP runbooks" })
  listArticles(
    @Query("category") category?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("tag") tag?: string,
  ) {
    return this.knowledge.listArticles({ category, status, search, tag });
  }

  @Get("articles/:id")
  @Permissions("system.knowledge.read")
  @ApiOperation({ summary: "Get article details by ID" })
  getArticle(@Param("id") id: string) {
    return this.knowledge.getArticle(id);
  }

  @Post("articles")
  @Permissions("system.knowledge.manage")
  @ApiOperation({ summary: "Create a new knowledge article or SOP runbook (EC-15.1)" })
  createArticle(
    @Body()
    body: {
      title: string;
      slug?: string;
      category?: string;
      tags?: string[];
      excerpt?: string;
      content: string;
      targetAudience?: "OPERATOR" | "TENANT_ADMIN" | "DEVELOPER" | "ALL";
      readTimeMinutes?: number;
      author?: string;
      status?: "DRAFT" | "PUBLISHED";
    },
  ) {
    return this.knowledge.createArticle(body);
  }

  @Patch("articles/:id")
  @Permissions("system.knowledge.manage")
  @ApiOperation({ summary: "Update an existing knowledge article" })
  updateArticle(
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.knowledge.updateArticle(id, body);
  }

  @Post("articles/:id/publish")
  @Permissions("system.knowledge.manage")
  @ApiOperation({ summary: "Publish article from draft to live (EC-15.1)" })
  publishArticle(@Param("id") id: string) {
    return this.knowledge.publishArticle(id);
  }

  @Post("articles/:id/archive")
  @Permissions("system.knowledge.manage")
  @ApiOperation({ summary: "Archive article" })
  archiveArticle(@Param("id") id: string) {
    return this.knowledge.archiveArticle(id);
  }

  @Delete("articles/:id")
  @Permissions("system.knowledge.manage")
  @ApiOperation({ summary: "Delete article" })
  deleteArticle(@Param("id") id: string) {
    return this.knowledge.deleteArticle(id);
  }

  @Get("learning-paths")
  @Permissions("system.knowledge.read")
  @ApiOperation({ summary: "List training curricula and learning paths (EC-15.2)" })
  listLearningPaths() {
    return this.knowledge.listLearningPaths();
  }

  @Get("learning-paths/:id")
  @Permissions("system.knowledge.read")
  @ApiOperation({ summary: "Get learning path details" })
  getLearningPath(@Param("id") id: string) {
    return this.knowledge.getLearningPath(id);
  }

  @Post("learning-paths")
  @Permissions("system.knowledge.manage")
  @ApiOperation({ summary: "Create new learning path with ordered curriculum modules (EC-15.2)" })
  createLearningPath(
    @Body()
    body: {
      title: string;
      description: string;
      targetRole?: string;
      modules?: {
        title: string;
        type: LearningModuleType;
        durationMinutes: number;
        contentRef?: string;
        description: string;
      }[];
    },
  ) {
    return this.knowledge.createLearningPath(body);
  }

  @Post("learning-paths/:id/reorder")
  @Permissions("system.knowledge.manage")
  @ApiOperation({ summary: "Reorder learning path modules (EC-15.2)" })
  reorderModules(
    @Param("id") id: string,
    @Body() body: { moduleIds: string[] },
  ) {
    return this.knowledge.reorderModules(id, body.moduleIds || []);
  }

  @Get("metrics")
  @Permissions("system.knowledge.read")
  @ApiOperation({ summary: "Get platform adoption and curriculum metrics" })
  getMetrics() {
    return this.knowledge.getMetrics();
  }
}
