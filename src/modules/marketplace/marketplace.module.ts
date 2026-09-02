import { Module } from "@nestjs/common";
import { ExtensionGatewayClientModule } from "../../common/integrations/extension-gateway-client.module";
import { AppProvisioningService } from "./services/app-provisioning.service";
import { BundleStoreService } from "./services/bundle-store.service";
import { DeveloperController } from "./controllers/developer.controller";
import { MarketplaceController } from "./controllers/marketplace.controller";
import { MarketplaceDeepController } from "./controllers/marketplace-deep.controller";
import { MarketplaceDeepService } from "./services/marketplace-deep.service";
import { MarketplaceService } from "./services/marketplace.service";
import { MarketplaceEnterpriseModule } from "./marketplace-enterprise.module";
import { StorefrontController } from "./controllers/storefront.controller";
import { StorefrontService } from "./services/storefront.service";
import { VendorService } from "./services/vendor.service";
import { PayoutService } from "./services/payout.service";

import { MarketplaceRepository } from "./repositories/marketplace.repository";

@Module({
  imports: [ExtensionGatewayClientModule, MarketplaceEnterpriseModule],
  controllers: [
    MarketplaceController,
    DeveloperController,
    MarketplaceDeepController,
    StorefrontController,
  ],
  providers: [
    MarketplaceRepository,
    PayoutService,
    BundleStoreService,
    AppProvisioningService,
    VendorService,
    StorefrontService,
    MarketplaceService,
    MarketplaceDeepService,
  ],
  exports: [
    MarketplaceRepository,
    MarketplaceService,
    BundleStoreService,
    AppProvisioningService,
    VendorService,
    StorefrontService,
    MarketplaceDeepService,
  ],
})
export class MarketplaceModule {}
