import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../common/guards/rbac.guard";
import { ControlPlaneGuard } from '../../common/guards/control-plane.guard';
import { Permissions } from "../../common/decorators/permissions.decorator";
import { SkipTenantScope } from '../../common/decorators/skip-tenant-scope.decorator';
import { SaasResellerChannelDeepService } from "./reseller-channel.service";

@ApiTags("SaasResellerChannelDeep")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RbacGuard, ControlPlaneGuard)
@Controller("platform/v1/reseller-channel-deep")
@SkipTenantScope()
export class SaasResellerChannelDeepController {
  constructor(
    private readonly resellerService: SaasResellerChannelDeepService,
  ) {}

  @ApiOperation({ summary: "Get partner reseller channels" })
  @Permissions("system.resellers.read")
  @Get("resellers")
  async getResellers() {
    return this.resellerService.getResellers();
  }

  @ApiOperation({ summary: "Create reseller channel" })
  @Permissions("system.resellers.create")
  @Post("resellers")
  async createReseller(@Body() dto: any) {
    return this.resellerService.createReseller(dto);
  }

  @ApiOperation({ summary: "Get reseller commissions" })
  @Permissions("system.resellers.read")
  @Get("commissions")
  async getCommissions(
    @Query("resellerId") resellerId?: string,
    @Query("period") period?: string,
  ) {
    return this.resellerService.getCommissions(resellerId, period);
  }

  @ApiOperation({ summary: "Record reseller commission" })
  @Permissions("system.resellers.update")
  @Post("commissions")
  async recordCommission(@Body() dto: any) {
    return this.resellerService.recordCommission(dto);
  }
}
