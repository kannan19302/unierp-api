import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import {
  createCustomObjectSchema,
  addCustomObjectFieldSchema,
  type CreateCustomObjectInput,
  type AddCustomObjectFieldInput,
} from "@kannan19302/shared";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { TrackChanges } from "../../../common/decorators/track-changes.decorator";
import { ChangeHistoryInterceptor } from "../../../common/interceptors/change-history.interceptor";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { BuilderDataObjectsService } from "../services/builder-data-objects.service";

interface AuthenticatedRequest extends Request {
  user: {
    tenantId: string;
    userId: string;
    email: string;
    roles: string[];
    orgId?: string;
  };
}

@Controller("builder/data-objects")
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(ChangeHistoryInterceptor)
export class DataObjectsController {
  constructor(private readonly service: BuilderDataObjectsService) {}

  @Get()
  @Permissions("builder.data-object.read")
  async list(@Req() req: AuthenticatedRequest) {
    return this.service.list(req.user.tenantId);
  }

  @Get(":id")
  @Permissions("builder.data-object.read")
  async getById(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.getById(req.user.tenantId, id);
  }

  @Post()
  @Permissions("builder.data-object.create")
  @TrackChanges("CustomObjectDefinition")
  async create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createCustomObjectSchema))
    dto: CreateCustomObjectInput,
  ) {
    return this.service.create(req.user.tenantId, req.user.userId, dto);
  }

  @Post(":id/fields")
  @Permissions("builder.data-object.update")
  @TrackChanges("CustomObjectDefinition")
  async addField(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addCustomObjectFieldSchema))
    dto: AddCustomObjectFieldInput,
  ) {
    return this.service.addField(req.user.tenantId, id, dto);
  }

  @Delete(":id")
  @Permissions("builder.data-object.delete")
  @TrackChanges("CustomObjectDefinition")
  async archive(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.archive(req.user.tenantId, id);
  }
}
