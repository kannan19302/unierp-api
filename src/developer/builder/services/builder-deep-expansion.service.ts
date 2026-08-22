import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { ArtifactRegistryService } from "../../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../../platform/artifact-revisions.service";

@Injectable()
export class BuilderDeepExpansionService {
  constructor(@Optional() private readonly artifacts?: ArtifactRegistryService, @Optional() private readonly revisions?: ArtifactRevisionsService) {}
  private get prisma() {
    return prisma as any;
  }

  private async mirrorConnector(tenantId: string, connector: any) {
    const slug = `connector-${String(connector.name ?? connector.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || connector.id}`;
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "CONNECTOR_DEFINITION", artifactId: connector.id, name: connector.name, slug, status: connector.isActive ? "PUBLISHED" : "DRAFT" });
    if (!artifact || !this.revisions) return;
    const integrations = connector.connectorIntegrations ?? await this.prisma.integration.findMany({ where: { tenantId, connectorId: connector.id } });
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: connector.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "CONNECTOR_DEFINITION", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: connector.name, description: connector.description ?? undefined },
      spec: { connectorType: connector.connectorType, baseUrl: connector.baseUrl ?? null, authType: connector.authType, headers: connector.headers ?? {}, timeout: connector.timeout ?? 30, retryCount: connector.retryCount ?? 3, integrations: integrations.map((integration: any) => ({ id: integration.id, name: integration.name, description: integration.description ?? null, direction: integration.direction, sourceEntity: integration.sourceEntity ?? null, targetEndpoint: integration.targetEndpoint ?? null, fieldMappings: integration.fieldMappings ?? [], transformations: integration.transformations ?? [], triggerType: integration.triggerType, schedule: integration.schedule ?? null, isActive: Boolean(integration.isActive) })) },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "integration_connectors", id: connector.id, credentialPolicy: "vault-reference-required" } },
    } });
  }

  // 1. Data Model Builder (Custom Objects & Fields)
  async createDataModel(tenantId: string, data: any) {
    const model = await this.prisma.builderDataModel.create({
      data: {
        ...data,
        tenantId,
        dataFields: data.fields
          ? {
              createMany: {
                data: data.fields.map((f: any) => ({ ...f, tenantId })),
              },
            }
          : undefined,
      },
      include: { dataFields: true, dataRelationships: true, dataViews: true },
    });
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "DATA_OBJECT", artifactId: model.id, name: model.name, slug: model.tableName, status: model.isPublished ? "PUBLISHED" : "DRAFT", icon: model.icon ?? null });
    if (artifact && this.revisions) await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: model.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "DATA_OBJECT", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: model.name, description: model.description ?? undefined },
      spec: { tableName: model.tableName, displayName: model.displayName ?? null, fields: (model.dataFields ?? []).map((field: any) => ({ name: field.name, displayName: field.displayName ?? null, type: field.fieldType, required: Boolean(field.isRequired), unique: Boolean(field.isUnique), indexed: Boolean(field.isIndexed), options: field.options ?? null, validation: field.validation ?? null })) },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "builder_data_models", id: model.id, module: model.module ?? null } },
    } });
    return model;
  }

  async getDataModels(tenantId: string) {
    return this.prisma.builderDataModel.findMany({
      where: { tenantId },
      include: { dataFields: true, dataRelationships: true, dataViews: true },
    });
  }

  async addDataField(tenantId: string, modelId: string, data: any) {
    return this.prisma.builderDataField.create({
      data: { ...data, modelId, tenantId },
    });
  }

  // 2. Business Rule Engine
  async createBusinessRule(tenantId: string, data: any) {
    return this.prisma.businessRule.create({
      data: { ...data, tenantId },
      include: { ruleExecutions: { take: 10 } },
    });
  }

  async getBusinessRules(tenantId: string) {
    return this.prisma.businessRule.findMany({
      where: { tenantId },
      include: { ruleExecutions: { take: 10 } },
    });
  }

  async executeBusinessRule(
    tenantId: string,
    ruleId: string,
    entityId: string,
  ) {
    const startTime = Date.now();
    const rule = await this.prisma.businessRule.findFirst({
      where: { id: ruleId, tenantId },
    });
    if (!rule)
      throw new NotFoundException(`Business Rule #${ruleId} not found`);

    // Rule execution logic simulation
    const duration = (Date.now() - startTime) / 1000;
    const execution = await this.prisma.businessRuleExecution.create({
      data: {
        tenantId,
        ruleId,
        entityId,
        status: "SUCCESS",
        result: { evaluatedConditions: true, actionsTriggered: rule.actions },
        duration,
      },
    });

    await this.prisma.businessRule.update({
      where: { id: ruleId },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    });

    return execution;
  }

  // 3. Integration Builder & Connectors
  async createIntegrationConnector(tenantId: string, data: any) {
    const connector = await this.prisma.integrationConnector.create({
      data: { ...data, tenantId },
      include: { connectorIntegrations: true },
    });
    await this.mirrorConnector(tenantId, connector);
    return connector;
  }

  async createIntegration(tenantId: string, connectorId: string, data: any) {
    const integration = await this.prisma.integration.create({
      data: { ...data, connectorId, tenantId },
    });
    if (this.artifacts && this.revisions) {
      const connector = await this.prisma.integrationConnector.findFirst({ where: { id: connectorId, tenantId }, include: { connectorIntegrations: true } });
      if (connector) await this.mirrorConnector(tenantId, connector);
    }
    return integration;
  }

  // 4. Document Template Builder
  async createDocumentTemplate(tenantId: string, data: any) {
    return this.prisma.builderDocumentTemplate.create({
      data: { ...data, tenantId },
    });
  }

  async renderDocument(tenantId: string, templateId: string, variables: any) {
    const template = await this.prisma.builderDocumentTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!template)
      throw new NotFoundException(`Document Template #${templateId} not found`);

    const render = await this.prisma.builderDocumentRender.create({
      data: {
        tenantId,
        templateId,
        variables,
        outputFormat: template.templateType || "PDF",
        status: "COMPLETED",
        fileUrl: `/renders/${templateId}-${Date.now()}.${(template.templateType || "pdf").toLowerCase()}`,
      },
    });

    await this.prisma.builderDocumentTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    });

    return render;
  }

  // 5. Chatbot Builder
  async createChatbot(tenantId: string, data: any) {
    return this.prisma.chatbotDefinition.create({
      data: {
        ...data,
        tenantId,
        botIntents: data.intents
          ? {
              createMany: {
                data: data.intents.map((i: any) => ({ ...i, tenantId })),
              },
            }
          : undefined,
      },
      include: { botIntents: true },
    });
  }

  // 6. Report & Dashboard Builders
  async createReportDefinition(tenantId: string, data: any) {
    return this.prisma.reportDefinition.create({
      data: { ...data, tenantId },
    });
  }

  async createDashboardDefinition(tenantId: string, data: any) {
    return this.prisma.dashboardDefinition.create({
      data: {
        ...data,
        tenantId,
        dashboardWidgets: data.widgets
          ? {
              createMany: {
                data: data.widgets.map((w: any) => ({ ...w, tenantId })),
              },
            }
          : undefined,
      },
      include: { dashboardWidgets: true },
    });
  }

  // 7. Event & Trigger Builder
  async createEventDefinition(tenantId: string, data: any) {
    return this.prisma.eventDefinition.create({
      data: {
        ...data,
        tenantId,
        eventTriggers: data.triggers
          ? {
              createMany: {
                data: data.triggers.map((t: any) => ({ ...t, tenantId })),
              },
            }
          : undefined,
      },
      include: { eventTriggers: true },
    });
  }

  // 8. Custom API Builder
  async createBuilderApi(tenantId: string, data: any) {
    return this.prisma.builderApi.create({
      data: { ...data, tenantId },
    });
  }
}
