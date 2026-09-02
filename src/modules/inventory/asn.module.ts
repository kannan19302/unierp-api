import { Module } from "@nestjs/common";
import { AsnService } from "./services/asn.service";
import { AsnController } from "./controllers/asn.controller";

@Module({ providers: [AsnService], controllers: [AsnController] })
export class AsnModule {}
