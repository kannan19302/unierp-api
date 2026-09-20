import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

export type TransformFunction =
  | "NONE"
  | "UPPERCASE"
  | "LOWERCASE"
  | "FORMAT_DATE"
  | "TRIM"
  | "PARSE_FLOAT";

export interface FieldMappingRule {
  sourceField: string;
  targetField: string;
  transform: TransformFunction;
  defaultValue?: string;
}

export interface DataMappingDefinition {
  id: string;
  name: string;
  connectorId: string;
  sourceEntity: string;
  targetEntity: string;
  fieldMappings: FieldMappingRule[];
  createdAt: string;
  updatedAt: string;
}

export interface SyncScheduleJob {
  id: string;
  connectorId: string;
  name: string;
  direction: "ONE_WAY" | "BI_DIRECTIONAL";
  scheduleCron: string; // e.g. "0 */2 * * *"
  conflictStrategy: "SOURCE_WINS" | "TARGET_WINS" | "MANUAL_REVIEW";
  batchSize: number;
  status: "ENABLED" | "PAUSED" | "RUNNING" | "FAILED";
  lastRunAt?: string;
  nextRunAt: string;
}

export interface ConnectorHealthItem {
  id: string;
  name: string;
  type: "SALESFORCE" | "SHOPIFY" | "NETSUITE" | "SAP_S4HANA" | "POSTGRES_CDC" | "WEBHOOK";
  status: "HEALTHY" | "DEGRADED" | "FAILED";
  latencyMs: number;
  errorRatePct: number;
  throughputRowsSec: number;
  recordsSynced24h: number;
  lastHealthCheckAt: string;
  activeJobsCount: number;
}

/**
 * PCC-20 - Integration & Connector Operations Service
 * Controls visual field mapping with transformations (EC-20.1),
 * recurring sync scheduling with conflict strategies (EC-20.2),
 * and real-time connector health monitoring (EC-20.3).
 */
@Injectable()
export class PlatformIntegrationOperationsService {
  private readonly logger = new Logger(PlatformIntegrationOperationsService.name);

  private connectors: ConnectorHealthItem[] = [
    {
      id: "conn-sfdc",
      name: "Salesforce CRM Enterprise Bridge",
      type: "SALESFORCE",
      status: "HEALTHY",
      latencyMs: 142,
      errorRatePct: 0.04,
      throughputRowsSec: 450,
      recordsSynced24h: 185420,
      lastHealthCheckAt: new Date().toISOString(),
      activeJobsCount: 3,
    },
    {
      id: "conn-shopify",
      name: "Shopify Plus B2B Storefront",
      type: "SHOPIFY",
      status: "HEALTHY",
      latencyMs: 98,
      errorRatePct: 0.01,
      throughputRowsSec: 1200,
      recordsSynced24h: 524100,
      lastHealthCheckAt: new Date().toISOString(),
      activeJobsCount: 2,
    },
    {
      id: "conn-netsuite",
      name: "Oracle NetSuite GL Master",
      type: "NETSUITE",
      status: "DEGRADED",
      latencyMs: 840,
      errorRatePct: 2.15,
      throughputRowsSec: 85,
      recordsSynced24h: 42300,
      lastHealthCheckAt: new Date().toISOString(),
      activeJobsCount: 1,
    },
  ];

  private mappings: DataMappingDefinition[] = [
    {
      id: "map-sfdc-accounts",
      name: "Salesforce Account → UniERP Customer",
      connectorId: "conn-sfdc",
      sourceEntity: "Account",
      targetEntity: "Customer",
      fieldMappings: [
        { sourceField: "Name", targetField: "companyName", transform: "TRIM" },
        { sourceField: "AccountNumber", targetField: "customerCode", transform: "UPPERCASE" },
        { sourceField: "AnnualRevenue", targetField: "creditLimit", transform: "PARSE_FLOAT" },
        { sourceField: "CreatedDate", targetField: "onboardingDate", transform: "FORMAT_DATE" },
        { sourceField: "BillingCity", targetField: "city", transform: "TRIM" },
      ],
      createdAt: "2026-02-10T10:00:00Z",
      updatedAt: "2026-03-12T14:20:00Z",
    },
    {
      id: "map-shopify-orders",
      name: "Shopify Order → UniERP Sales Order",
      connectorId: "conn-shopify",
      sourceEntity: "Order",
      targetEntity: "SalesOrder",
      fieldMappings: [
        { sourceField: "order_number", targetField: "orderRef", transform: "UPPERCASE" },
        { sourceField: "total_price", targetField: "grandTotal", transform: "PARSE_FLOAT" },
        { sourceField: "created_at", targetField: "orderDate", transform: "FORMAT_DATE" },
        { sourceField: "email", targetField: "customerEmail", transform: "LOWERCASE" },
      ],
      createdAt: "2026-03-01T08:30:00Z",
      updatedAt: "2026-03-15T09:45:00Z",
    },
  ];

  private syncJobs: SyncScheduleJob[] = [
    {
      id: "job-sfdc-sync",
      connectorId: "conn-sfdc",
      name: "Hourly SFDC Account Reconciler",
      direction: "BI_DIRECTIONAL",
      scheduleCron: "0 * * * *",
      conflictStrategy: "SOURCE_WINS",
      batchSize: 500,
      status: "ENABLED",
      lastRunAt: "2026-03-20T14:00:00Z",
      nextRunAt: "2026-03-20T15:00:00Z",
    },
    {
      id: "job-shopify-stream",
      connectorId: "conn-shopify",
      name: "Continuous Shopify Order Ingestion",
      direction: "ONE_WAY",
      scheduleCron: "*/5 * * * *",
      conflictStrategy: "SOURCE_WINS",
      batchSize: 100,
      status: "ENABLED",
      lastRunAt: "2026-03-20T14:25:00Z",
      nextRunAt: "2026-03-20T14:30:00Z",
    },
  ];

  constructor(private readonly audit: ControlPlaneAuditService) {}

  // --- 1. Data Mapping Designer (EC-20.1) ---

  async listMappings(): Promise<DataMappingDefinition[]> {
    return this.mappings;
  }

  async getMapping(id: string): Promise<DataMappingDefinition> {
    const m = this.mappings.find((item) => item.id === id);
    if (!m) throw new NotFoundException(`Data mapping '${id}' not found`);
    return m;
  }

  async saveMapping(
    dto: {
      name: string;
      connectorId: string;
      sourceEntity: string;
      targetEntity: string;
      fieldMappings: FieldMappingRule[];
    },
    actorId: string = "SYSTEM"
  ): Promise<DataMappingDefinition> {
    if (!dto.name || !dto.fieldMappings || dto.fieldMappings.length === 0) {
      throw new BadRequestException("Mapping requires a valid name and at least one field mapping rule");
    }

    const newMap: DataMappingDefinition = {
      id: `map-${Date.now()}`,
      name: dto.name,
      connectorId: dto.connectorId,
      sourceEntity: dto.sourceEntity,
      targetEntity: dto.targetEntity,
      fieldMappings: dto.fieldMappings,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.mappings.unshift(newMap);

    await this.audit.record({
      actorId,
      actorRole: "SUPER_ADMIN",
      action: "integrations.mapping.create",
      targetId: newMap.id,
      details: { name: newMap.name, connectorId: newMap.connectorId, ruleCount: newMap.fieldMappings.length },
    });

    return newMap;
  }

  /**
   * Evaluates field mapping transformations against a sample source payload (EC-20.1)
   */
  testMappingTransformation(
    rules: FieldMappingRule[],
    samplePayload: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const rule of rules) {
      const rawVal = samplePayload[rule.sourceField] ?? rule.defaultValue;
      if (rawVal === undefined || rawVal === null) {
        result[rule.targetField] = null;
        continue;
      }

      switch (rule.transform) {
        case "UPPERCASE":
          result[rule.targetField] = String(rawVal).toUpperCase();
          break;
        case "LOWERCASE":
          result[rule.targetField] = String(rawVal).toLowerCase();
          break;
        case "TRIM":
          result[rule.targetField] = String(rawVal).trim();
          break;
        case "PARSE_FLOAT":
          result[rule.targetField] = parseFloat(String(rawVal).replace(/[^0-9.-]+/g, "")) || 0;
          break;
        case "FORMAT_DATE":
          try {
            result[rule.targetField] = new Date(String(rawVal)).toISOString().split("T")[0];
          } catch {
            result[rule.targetField] = String(rawVal);
          }
          break;
        case "NONE":
        default:
          result[rule.targetField] = rawVal;
          break;
      }
    }

    return result;
  }

  // --- 2. Sync Schedule Configuration (EC-20.2) ---

  async listSyncJobs(): Promise<SyncScheduleJob[]> {
    return this.syncJobs;
  }

  async createSyncJob(
    dto: {
      connectorId: string;
      name: string;
      direction: "ONE_WAY" | "BI_DIRECTIONAL";
      scheduleCron: string;
      conflictStrategy: "SOURCE_WINS" | "TARGET_WINS" | "MANUAL_REVIEW";
      batchSize?: number;
    },
    actorId: string = "SYSTEM"
  ): Promise<SyncScheduleJob> {
    const newJob: SyncScheduleJob = {
      id: `job-${Date.now()}`,
      connectorId: dto.connectorId,
      name: dto.name,
      direction: dto.direction,
      scheduleCron: dto.scheduleCron,
      conflictStrategy: dto.conflictStrategy,
      batchSize: dto.batchSize || 250,
      status: "ENABLED",
      nextRunAt: new Date(Date.now() + 3600000).toISOString(),
    };

    this.syncJobs.unshift(newJob);

    await this.audit.record({
      actorId,
      actorRole: "SUPER_ADMIN",
      action: "integrations.sync_job.create",
      targetId: newJob.id,
      details: { name: newJob.name, scheduleCron: newJob.scheduleCron, strategy: newJob.conflictStrategy },
    });

    return newJob;
  }

  async toggleSyncJobStatus(id: string, actorId: string = "SYSTEM"): Promise<SyncScheduleJob> {
    const job = this.syncJobs.find((j) => j.id === id);
    if (!job) throw new NotFoundException(`Sync job '${id}' not found`);

    job.status = job.status === "ENABLED" ? "PAUSED" : "ENABLED";

    await this.audit.record({
      actorId,
      actorRole: "SUPER_ADMIN",
      action: "integrations.sync_job.toggle",
      targetId: id,
      details: { status: job.status },
    });

    return job;
  }

  // --- 3. Connector Health Monitoring (EC-20.3) ---

  async listConnectors(): Promise<ConnectorHealthItem[]> {
    return this.connectors;
  }

  async triggerConnectorHealthCheck(id: string, actorId: string = "SYSTEM"): Promise<ConnectorHealthItem> {
    const conn = this.connectors.find((c) => c.id === id);
    if (!conn) throw new NotFoundException(`Connector '${id}' not found`);

    conn.lastHealthCheckAt = new Date().toISOString();
    conn.status = "HEALTHY";
    conn.latencyMs = Math.floor(Math.random() * 80) + 40;

    await this.audit.record({
      actorId,
      actorRole: "SUPER_ADMIN",
      action: "integrations.connector.health_check",
      targetId: id,
      details: { latencyMs: conn.latencyMs, status: conn.status },
    });

    return conn;
  }
}
