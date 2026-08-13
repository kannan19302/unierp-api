import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";

@Injectable()
export class BuilderWorkflowsService {
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
    return prisma.builderWorkflow.create({
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

    return prisma.builderWorkflow.update({
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
  }

  async deleteWorkflow(tenantId: string, id: string) {
    const wf = await prisma.builderWorkflow.findFirst({
      where: { id, tenantId },
    });
    if (!wf) throw new NotFoundException("Workflow not found");
    return prisma.builderWorkflow.delete({ where: { id } });
  }
}
