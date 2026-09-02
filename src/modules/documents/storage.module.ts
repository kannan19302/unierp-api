import { Module } from "@nestjs/common";
import { StorageController } from "./controllers/storage.controller";
import { StorageService } from "./services/storage.service";
import { StorageBucketsService } from "./services/storage-buckets.service";
import { StoragePoliciesService } from "./services/storage-policies.service";
import { StorageAdvancedController } from "./controllers/storage-advanced.controller";
import { StorageAdvancedService } from "./services/storage-advanced.service";
import { StorageExpansionController } from "./controllers/storage-expansion.controller";
import { StorageExtController } from "./controllers/storage-ext.controller";

import { StorageRepository } from "./repositories/storage.repository";

@Module({
  controllers: [
    StorageController,
    StorageAdvancedController,
    StorageExpansionController,
    StorageExtController,
  ],
  providers: [
    StorageRepository,
    StorageService,
    StorageBucketsService,
    StoragePoliciesService,
    StorageAdvancedService,
  ],
  exports: [
    StorageRepository,
    StorageService,
    StorageBucketsService,
    StoragePoliciesService,
    StorageAdvancedService,
  ],
})
export class StorageModule {}
