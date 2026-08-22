import {
  Injectable,
  Optional,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ArtifactRegistryService } from "../platform/artifact-registry.service";
import { ArtifactRevisionsService } from "../platform/artifact-revisions.service";

@Injectable()
export class BuilderWorkflowsService {
  constructor(@Optional() private readonly artifacts?: ArtifactRegistryService, @Optional() private readonly revisions?: ArtifactRevisionsService) {}

  private async mirrorCanonicalWorkflow(tenantId: string, workflow: any) {
    const artifact = await this.artifacts?.record({ tenantId, artifactType: "WORKFLOW", artifactId: workflow.id, name: workflow.name, status: workflow.status });
    if (!artifact || !this.revisions) return;
    await this.revisions.syncLegacyProjection({ tenantId, artifactId: artifact.id, scope: { kind: "LIBRARY" }, createdBy: workflow.createdBy ?? null, source: {
      apiVersion: "unierp.dev/v1", kind: "WORKFLOW", metadata: { id: artifact.id, namespace: `tenant.${tenantId}`, name: workflow.name, description: workflow.description ?? undefined },
      spec: { trigger: { type: workflow.trigger ?? "MANUAL", configuration: workflow.settings ?? {} }, nodes: Array.isArray(workflow.nodes) ? workflow.nodes.map((node: any) => ({ id: String(node.id), type: String(node.type ?? "TASK"), configuration: node.configuration ?? node })) : [], edges: Array.isArray(workflow.edges) ? workflow.edges.map((edge: any, index: number) => ({ id: String(edge.id ?? index), source: String(edge.source ?? edge.from), target: String(edge.target ?? edge.to), condition: edge.condition })) : [] },
      interfaces: { inputs: [], outputs: [], events: [] }, dependencies: [], capabilities: [], tests: [], extensions: { legacyProjection: { table: "builder_workflows", id: workflow.id, docType: workflow.docType ?? null, settings: workflow.settings ?? {} } },
    } });
  }
  async getWorkflows(tenantId: string) {
    return prisma.builderWorkflow.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getWorkflowById(tenantId: string, id: string) {
    const wf = await prisma.builderWorkflow.findFirst({
      where: { id, tenantId },
    });
    if (!wf) throw new NotFoundException("Workflow not found");
    return wf;
  }

  async createWorkflow(
    tenantId: string,
    dto: {
      name: string;
      description?: string;
      docType?: string;
      trigger?: string;
      nodes?: any;
      edges?: any;
      settings?: any;
    },
  ) {
    const created = await prisma.builderWorkflow.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description || null,
        docType: dto.docType || null,
        trigger: dto.trigger || "SUBMIT",
        nodes: dto.nodes || [],
        edges: dto.edges || [],
        settings: dto.settings || {},
      },
    });
    await this.mirrorCanonicalWorkflow(tenantId, created);
    return created;
  }

  async updateWorkflow(
    tenantId: string,
    id: string,
    dto: Partial<{
      name: string;
      description: string;
      docType: string;
      status: string;
      trigger: string;
      nodes: any;
      edges: any;
      settings: any;
    }>,
  ) {
    const wf = await prisma.builderWorkflow.findFirst({
      where: { id, tenantId },
    });
    if (!wf) throw new NotFoundException("Workflow not found");

    const updated = await prisma.builderWorkflow.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.docType !== undefined && { docType: dto.docType }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.trigger !== undefined && { trigger: dto.trigger }),
        ...(dto.nodes !== undefined && { nodes: dto.nodes }),
        ...(dto.edges !== undefined && { edges: dto.edges }),
        ...(dto.settings !== undefined && { settings: dto.settings }),
      },
    });
    await this.mirrorCanonicalWorkflow(tenantId, updated);
    return updated;
  }

  async deleteWorkflow(tenantId: string, id: string) {
    const wf = await prisma.builderWorkflow.findFirst({
      where: { id, tenantId },
    });
    if (!wf) throw new NotFoundException("Workflow not found");
    const deleted = await prisma.builderWorkflow.delete({ where: { id } });
    await this.artifacts?.retire(tenantId, "WORKFLOW", id);
    return deleted;
  }
}
