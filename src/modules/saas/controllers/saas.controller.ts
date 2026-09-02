import { BadRequestException, Controller, Get, Headers, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodBody } from "../../../common/decorators/zod-body.decorator";
import { Request } from "express";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RbacGuard } from "../../../common/guards/rbac.guard";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { SaasService } from "../services/saas.service";
import { StorageMeteringService } from "../services/storage-metering.service";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Public } from "../../../common/decorators/public.decorator";
import { BillingService } from "../services/billing.service";

interface AuthenticatedRequest extends Request {
  user: {
    tenantId: string;
    userId: string;
    email: string;
    roles: string[];
  };
}

@ApiTags("saas")
@ApiBearerAuth()
@Controller("saas")
export class SaasController {
  constructor(
    private readonly saasService: SaasService,
    private readonly storageMetering: StorageMeteringService,
    private readonly billingService: BillingService,
  ) {}

  @ApiOperation({ summary: "Get plans" })
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions("saas.read")
  @Get("plans")
  async getPlans(@Req() req: Request) {
    const tenantId = (req as Partial<AuthenticatedRequest>).user?.tenantId;
    return this.saasService.getPlans(tenantId);
  }

  @ApiOperation({ summary: "Get subscription" })
  @Get("subscription")
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions("finance.invoice.read") // Mapping to base billing permissions
  async getSubscription(@Req() req: AuthenticatedRequest) {
    return this.saasService.getSubscription(req.user.tenantId);
  }

  @ApiOperation({ summary: "Get usage" })
  @Get("usage")
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions("finance.invoice.read")
  async getUsage(@Req() req: AuthenticatedRequest) {
    return this.saasService.getUsageRecords(req.user.tenantId);
  }

  @ApiOperation({ summary: "Stripe webhook" })
  @Public("Stripe webhook validates the provider signature against the unmodified request body before processing")
  @Post("webhooks/stripe")
  async stripeWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("stripe-signature") signature?: string,
  ) {
    if (!signature) throw new BadRequestException("Missing Stripe signature");
    if (!req.rawBody) throw new BadRequestException("Missing raw request body buffer");
    return this.billingService.processStripeWebhook(req.rawBody.toString("utf8"), signature);
  }

  @ApiOperation({ summary: "Get installed apps" })
  @Permissions("saas.read")
  @Get("installed-apps")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async getInstalledApps(@Req() req: AuthenticatedRequest) {
    return this.saasService.getInstalledApps(req.user.tenantId);
  }

  @ApiOperation({
    summary:
      "The canonical module/app catalog — every installable module and kernel app, with its route segments",
  })
  @Permissions("saas.read")
  @Get("app-catalog")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async getAppCatalog() {
    return this.saasService.getAppCatalog();
  }

  @ApiOperation({ summary: "Install app" })
  @Permissions("saas.create")
  @Post("install")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async installApp(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) body: { appId: string },
  ) {
    return this.saasService.installApp(req.user.tenantId, body.appId);
  }

  @ApiOperation({ summary: "Uninstall app" })
  @Permissions("saas.create")
  @Post("uninstall")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async uninstallApp(
    @Req() req: AuthenticatedRequest,
    @ZodBody(z.any()) body: { appId: string },
  ) {
    return this.saasService.uninstallApp(req.user.tenantId, body.appId);
  }

  @ApiOperation({ summary: "Create plan" })
  @Permissions("saas.subscription.manage")
  @Post("plans")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async createPlan(@ZodBody(z.any()) body: any) {
    return this.saasService.createPlan(body);
  }

  @ApiOperation({ summary: "Get coupons" })
  @Permissions("saas.read")
  @Get("coupons")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async getCoupons() {
    return this.saasService.getCoupons();
  }

  @ApiOperation({ summary: "Create coupon" })
  @Permissions("saas.subscription.manage")
  @Post("coupons")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async createCoupon(@ZodBody(z.any()) body: any) {
    return this.saasService.createCoupon(body);
  }

  // ─── Storage Metering ───

  @ApiOperation({ summary: "Get per-app storage usage" })
  @Permissions("saas.read")
  @Get("storage-usage")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async getStorageUsage(@Req() req: AuthenticatedRequest) {
    return this.storageMetering.getTenantUsage(req.user.tenantId);
  }

  @ApiOperation({ summary: "Recompute storage usage now" })
  @Permissions("saas.create")
  @Post("storage-usage/recompute")
  @UseGuards(JwtAuthGuard, RbacGuard)
  async recomputeStorage(@Req() req: AuthenticatedRequest) {
    return this.storageMetering.recomputeTenant(req.user.tenantId);
  }
}
