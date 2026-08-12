import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ReportingEngineService } from "./reporting-engine.service";

@Injectable()
export class ReportingDataDrilldownDeepService {
  constructor(private readonly reportingEngine: ReportingEngineService) {}

  async getDrilldownPaths(tenantId: string) {
    return [
      {
        id: "dd-1",
        tenantId,
        sourceDimension: "REGION",
        targetDimension: "COUNTRY",
        drilldownLevel: 1,
        isEnabled: true,
      },
      {
        id: "dd-2",
        tenantId,
        sourceDimension: "PRODUCT_CATEGORY",
        targetDimension: "SKU",
        drilldownLevel: 2,
        isEnabled: true,
      },
    ];
  }

  /**
   * E37 exit criterion: "A dashboard tile drills through to the
   * filtered record list that produced it." The previous
   * implementation returned the SAME three hardcoded fake rows
   * ("EMEA"/"APAC"/"Americas") for every call regardless of the
   * dimension, filter value, or metric requested — clicking any
   * dashboard tile would show identical fabricated numbers no matter
   * what was actually clicked. Now executes a real, filtered query
   * against the semantic layer's real underlying records: `entity`
   * names which module's data the tile summarizes, `dimension` is the
   * field that was aggregated to produce the tile, and `filterValue`
   * is the specific bucket the user drilled into — the same three
   * facts a real drill-through UI action carries.
   */
  async executeDrilldown(
    tenantId: string,
    dto: {
      entity: string;
      dimension: string;
      filterValue: string;
      metricKey?: string;
    },
  ) {
    if (!dto.entity) {
      throw new BadRequestException(
        "A drilldown requires the source entity the dashboard tile was built from.",
      );
    }
    const result = await this.reportingEngine.executeQuery(
      tenantId,
      dto.entity,
      {
        filters: { [dto.dimension]: dto.filterValue },
        limit: 100,
      },
    );
    if ((result as any).error) {
      throw new BadRequestException((result as any).error);
    }

    return {
      entity: dto.entity,
      dimension: dto.dimension,
      filterValue: dto.filterValue,
      metricKey: dto.metricKey,
      results: result.data ?? [],
      recordCount: (result.data ?? []).length,
      executedAt: new Date().toISOString(),
    };
  }
}
