import { Module } from "@nestjs/common";
import { AiEnterpriseService } from "./services/ai-enterprise.service";
import { AiEnterpriseController } from "./controllers/ai-enterprise.controller";

@Module({
  controllers: [AiEnterpriseController],
  providers: [AiEnterpriseService],
  exports: [AiEnterpriseService],
})
export class AiEnterpriseModule {}
