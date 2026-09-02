import { Module } from "@nestjs/common";
import { CommunicationEnterpriseController } from "./controllers/communication-enterprise.controller";
import { CommunicationEnterpriseService } from "./services/communication-enterprise.service";

@Module({
  controllers: [CommunicationEnterpriseController],
  providers: [
    CommunicationEnterpriseService,
    CommunicationEnterpriseController,
  ],
  exports: [CommunicationEnterpriseService],
})
export class CommunicationEnterpriseModule {}
