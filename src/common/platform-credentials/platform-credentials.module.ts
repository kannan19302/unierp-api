import { Module } from "@nestjs/common";
import { PlatformCredentialsService } from "./platform-credentials.service";
import { PlatformCredentialsController } from "./platform-credentials.controller";
import { EmailTemplateAdminController } from "./email-template-admin.controller";
import { TestEmailController } from "./test-email.controller";

@Module({
  controllers: [
    PlatformCredentialsController,
    EmailTemplateAdminController,
    TestEmailController,
  ],
  providers: [PlatformCredentialsService],
  exports: [PlatformCredentialsService],
})
export class PlatformCredentialsModule {}
