export interface ReportingSemanticField {
  name: string;
  label: string;
  type: string;
  aggregatable: boolean;
}

export interface ReportingSemanticEntity {
  name: string;
  label: string;
  table: string;
  fields: ReportingSemanticField[];
  /**
   * E46: "retrieval is permission-scoped so RAG cannot surface what the
   * user may not read." An entity carrying sensitive data (HR/payroll,
   * clinical, etc.) that a normal user could not read directly in the
   * UI must not become readable indirectly by asking the AI copilot a
   * natural-language question against it. When set, callers resolving
   * a query against this entity MUST verify the requesting user holds
   * this permission before executing it.
   */
  requiredPermission?: string;
}

export interface ReportingQueryOptions {
  filters?: Record<string, unknown>;
  groupBy?: string[];
  orderBy?: string;
  orderDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
  aggregations?: Array<{
    field: string;
    fn: "SUM" | "AVG" | "COUNT" | "MIN" | "MAX";
  }>;
}

export interface ReportingQueryResult {
  data: Record<string, unknown>[];
  entity?: string;
  grouped?: boolean;
  count?: number;
  total?: number;
  error?: string;
}

/** Read-only reporting capability consumed outside the Reporting module. */
export abstract class ReportingQueryClient {
  abstract getSemanticLayer(): ReportingSemanticEntity[];

  abstract executeQuery(
    tenantId: string,
    entity: string,
    options?: ReportingQueryOptions,
  ): Promise<ReportingQueryResult>;
}
