import { Module } from "@nestjs/common";
import { ExtensionRegistryController } from "./controllers/extension-registry.controller";
import { ExtensionRegistryService } from "./services/extension-registry.service";
import { ExtensionSchemaService } from "./services/extension-schema.service";
import { ExtensionSignatureService } from "./services/extension-signature.service";

import { AppsExtensionsController } from "./controllers/apps-extensions.controller";
import { AppsExtensionsService } from "./services/apps-extensions.service";

import { ExtensionRegistryRepository } from "./repositories/extension-registry.repository";

@Module({
  controllers: [ExtensionRegistryController, AppsExtensionsController],
  providers: [
    ExtensionRegistryRepository,
    ExtensionRegistryService,
    ExtensionSchemaService,
    ExtensionSignatureService,
    AppsExtensionsService,
  ],
  exports: [
    ExtensionRegistryRepository,
    ExtensionRegistryService,
    ExtensionSchemaService,
    ExtensionSignatureService,
    AppsExtensionsService,
  ],
})
export class ExtensionRegistryModule {}
