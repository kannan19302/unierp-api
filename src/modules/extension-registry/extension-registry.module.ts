import { Module } from "@nestjs/common";
import { ExtensionRegistryController } from "./extension-registry.controller";
import { ExtensionRegistryService } from "./extension-registry.service";
import { ExtensionSchemaService } from "./extension-schema.service";
import { ExtensionSignatureService } from "./extension-signature.service";

import { AppsExtensionsController } from "./apps-extensions.controller";
import { AppsExtensionsService } from "./apps-extensions.service";

@Module({
  controllers: [ExtensionRegistryController, AppsExtensionsController],
  providers: [
    ExtensionRegistryService,
    ExtensionSchemaService,
    ExtensionSignatureService,
    AppsExtensionsService,
  ],
  exports: [
    ExtensionRegistryService,
    ExtensionSchemaService,
    ExtensionSignatureService,
    AppsExtensionsService,
  ],
})
export class ExtensionRegistryModule {}
