import { DriveGeneratedController } from "./controllers/drive-generated.controller";
import { DriveGeneratedService } from "./services/drive-generated.service";
import { Module } from "@nestjs/common";
import { DriveController } from "./controllers/drive-drive.controller";
import { DriveDeepController } from "./controllers/drive-deep.controller";
import { DriveService } from "./services/drive.service";
import { DriveDeepService } from "./services/drive-deep.service";
import { DocumentStorageClientModule } from "../../common/integrations/document-storage-client.module";

import { DriveRepository } from "./repositories/drive.repository";

@Module({
  imports: [DocumentStorageClientModule],
  controllers: [DriveGeneratedController, DriveController, DriveDeepController],
  providers: [DriveRepository, DriveGeneratedService, DriveService, DriveDeepService],
  exports: [DriveRepository, DriveGeneratedService, DriveService, DriveDeepService],
})
export class DriveModule {}
