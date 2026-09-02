import { Module } from "@nestjs/common";
import { LotExpiryService } from "./services/lot-expiry.service";
import { LotExpiryController } from "./controllers/lot-expiry.controller";

@Module({ providers: [LotExpiryService], controllers: [LotExpiryController] })
export class LotExpiryModule {}
