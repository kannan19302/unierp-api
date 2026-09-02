import { Module } from "@nestjs/common";
import { YardManagementController } from "./controllers/yard-management.controller";
import { YardManagementService } from "./services/yard-management.service";

@Module({
  controllers: [YardManagementController],
  providers: [YardManagementService],
  exports: [YardManagementService],
})
export class YardManagementModule {}
