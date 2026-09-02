import { Module } from "@nestjs/common";
import { DriveController } from "./controllers/drive.controller";
import { DocumentsService } from "./services/documents.service";
import { DocumentsDeepController } from "./controllers/documents-deep.controller";
import { DocumentsDeepService } from "./services/documents-deep.service";
import { DocumentsAdvancedController } from "./controllers/documents-advanced.controller";
import { DocumentsAdvancedService } from "./services/documents-advanced.service";
import { DocumentsExpansionController } from "./controllers/documents-expansion.controller";
import { DocumentsExtController } from "./controllers/documents-ext.controller";
import { SignatureWorkflowService } from "./services/signature-workflow.service";
import { PlatformCredentialsModule } from "../../common/platform-credentials/platform-credentials.module";

import { DocumentsRepository } from "./repositories/documents.repository";

@Module({
  imports: [PlatformCredentialsModule],
  controllers: [
    DriveController,
    DocumentsDeepController,
    DocumentsAdvancedController,
    DocumentsExpansionController,
    DocumentsExtController,
  ],
  providers: [
    DocumentsRepository,
    DocumentsService,
    DocumentsDeepService,
    DocumentsAdvancedService,
    SignatureWorkflowService,
  ],
  exports: [
    DocumentsRepository,
    DocumentsService,
    DocumentsDeepService,
    DocumentsAdvancedService,
    SignatureWorkflowService,
  ],
})
export class DocumentsModule {}
