import { Module } from "@nestjs/common";
import { ReportingModule } from "../../modules/analytics/reporting.module";
import { ReportingEngineService } from "../../modules/analytics/services/reporting-engine.service";
import { ReportingQueryClient } from "./reporting-query-client";

/** Composition-layer adapter for the reporting module's read-only query port. */
@Module({
  imports: [ReportingModule],
  providers: [
    { provide: ReportingQueryClient, useExisting: ReportingEngineService },
  ],
  exports: [ReportingQueryClient],
})
export class ReportingQueryClientModule {}
