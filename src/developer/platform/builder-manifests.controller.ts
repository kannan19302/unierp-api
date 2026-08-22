import { Controller, Get, Param, NotFoundException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  BUILDER_MANIFESTS_V1,
  builderManifestForKind,
  type CanonicalArtifactKind,
} from "@kannan19302/contracts";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";

@ApiTags("developer-platform-builders")
@ApiBearerAuth()
@Controller("dev/builders")
@UseGuards(JwtAuthGuard, RbacGuard)
export class BuilderManifestsController {
  @Get()
  @Permissions("builder.read")
  @ApiOperation({ summary: "Server-authoritative builder and portability manifests" })
  list() {
    return BUILDER_MANIFESTS_V1;
  }

  @Get(":kind")
  @Permissions("builder.read")
  get(@Param("kind") kind: CanonicalArtifactKind) {
    const manifest = builderManifestForKind(kind);
    if (!manifest) throw new NotFoundException("Builder manifest not found");
    return manifest;
  }
}
