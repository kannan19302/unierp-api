import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

interface BpmnElement {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, any>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface BpmnFlow {
  id: string;
  from: string;
  to: string;
  conditionExpression?: string;
}

interface BpmnProcess {
  id: string;
  name: string;
  key: string;
  elements: BpmnElement[];
  flows: BpmnFlow[];
  slaConfig: Record<string, any>;
  settings: Record<string, any>;
}

@Injectable()
export class BuilderBpmnService {
  async getBpmnProcesses(
    tenantId: string,
    params: { page?: number; limit?: number; search?: string } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;
    const where: any = { tenantId };
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { key: { contains: params.search, mode: "insensitive" } },
      ];
    }
    const [data, total] = await Promise.all([
      prisma.bpmnProcessDefinition.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.bpmnProcessDefinition.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getBpmnProcessById(tenantId: string, id: string) {
    const proc = await prisma.bpmnProcessDefinition.findFirst({
      where: { id, tenantId },
    });
    if (!proc) throw new NotFoundException("BPMN process not found");
    return proc;
  }

  async createBpmnProcess(tenantId: string, dto: any) {
    const existing = await prisma.bpmnProcessDefinition.findFirst({
      where: { tenantId, key: dto.key },
    });
    if (existing)
      throw new BadRequestException("A process with this key already exists");

    return prisma.bpmnProcessDefinition.create({
      data: {
        tenantId,
        name: dto.name,
        key: dto.key,
        description: dto.description || null,
        elements: dto.elements || [],
        flows: dto.flows || [],
        slaConfig: dto.slaConfig || {},
        settings: dto.settings || {},
      },
    });
  }

  async updateBpmnProcess(tenantId: string, id: string, dto: any) {
    const proc = await prisma.bpmnProcessDefinition.findFirst({
      where: { id, tenantId },
    });
    if (!proc) throw new NotFoundException("BPMN process not found");

    return prisma.bpmnProcessDefinition.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.elements !== undefined && { elements: dto.elements as any }),
        ...(dto.flows !== undefined && { flows: dto.flows as any }),
        ...(dto.bpmnXml !== undefined && { bpmnXml: dto.bpmnXml }),
        ...(dto.slaConfig !== undefined && { slaConfig: dto.slaConfig as any }),
        ...(dto.settings !== undefined && { settings: dto.settings as any }),
      },
    });
  }

  async deleteBpmnProcess(tenantId: string, id: string) {
    const proc = await prisma.bpmnProcessDefinition.findFirst({
      where: { id, tenantId },
    });
    if (!proc) throw new NotFoundException("BPMN process not found");
    return prisma.bpmnProcessDefinition.delete({ where: { id } });
  }

  async addGateway(tenantId: string, processId: string, dto: any) {
    const proc = await prisma.bpmnProcessDefinition.findFirst({
      where: { id: processId, tenantId },
    });
    if (!proc) throw new NotFoundException("BPMN process not found");

    const elements = [
      ...((proc.elements as any[]) || []),
      {
        id: dto.id || `gateway_${Date.now()}`,
        type: dto.type || "exclusiveGateway",
        label: dto.label || "Gateway",
        config: dto.config || {},
      },
    ];

    return prisma.bpmnProcessDefinition.update({
      where: { id: processId },
      data: { elements: elements as any },
    });
  }

  async addTimerEvent(tenantId: string, processId: string, dto: any) {
    const proc = await prisma.bpmnProcessDefinition.findFirst({
      where: { id: processId, tenantId },
    });
    if (!proc) throw new NotFoundException("BPMN process not found");

    await prisma.bpmnTimerDefinition.create({
      data: {
        tenantId,
        definitionId: processId,
        elementId: dto.elementId || `timer_${Date.now()}`,
        timerType: dto.timerType || "duration",
        timerValue: dto.timerValue || "PT1H",
        settings: dto.settings || {},
      },
    });

    const elements = [
      ...((proc.elements as any[]) || []),
      {
        id: dto.elementId || `timer_${Date.now()}`,
        type: "timerEvent",
        label: dto.label || "Timer",
        config: {
          timerType: dto.timerType || "duration",
          timerValue: dto.timerValue || "PT1H",
        },
      },
    ];

    return prisma.bpmnProcessDefinition.update({
      where: { id: processId },
      data: { elements: elements as any },
    });
  }

  async executeWorkflowInstance(tenantId: string, processId: string, dto: any) {
    const proc = await prisma.bpmnProcessDefinition.findFirst({
      where: { id: processId, tenantId },
    });
    if (!proc) throw new NotFoundException("BPMN process not found");

    const instance = await prisma.bpmnProcessInstance.create({
      data: {
        tenantId,
        definitionId: processId,
        variables: dto.variables || {},
        currentElements: dto.startElements || [],
        startedBy: dto.startedBy || null,
      },
    });

    const startElements =
      (proc.elements as any[])?.filter((e) => e.type === "startEvent") || [];
    for (const el of startElements) {
      await prisma.bpmnActivityInstance.create({
        data: {
          tenantId,
          instanceId: instance.id,
          elementId: el.id,
          elementType: el.type,
          label: el.label || "Start",
          assignedTo: dto.startedBy || null,
        },
      });
    }

    return instance;
  }

  async getBpmnInstances(tenantId: string, processId: string) {
    return prisma.bpmnProcessInstance.findMany({
      where: { tenantId, definitionId: processId },
      orderBy: { startedAt: "desc" },
      include: { definition: true },
    });
  }

  async getBpmnDashboard(tenantId: string) {
    const [totalProcesses, activeProcesses, totalInstances, runningInstances] =
      await Promise.all([
        prisma.bpmnProcessDefinition.count({ where: { tenantId } }),
        prisma.bpmnProcessDefinition.count({
          where: { tenantId, status: "ACTIVE" },
        }),
        prisma.bpmnProcessInstance.count({ where: { tenantId } }),
        prisma.bpmnProcessInstance.count({
          where: { tenantId, status: "RUNNING" },
        }),
      ]);

    const slaBreached = await prisma.bpmnProcessInstance.count({
      where: { tenantId, slaBreached: true },
    });

    return {
      totalProcesses,
      activeProcesses,
      totalInstances,
      runningInstances,
      slaBreached,
    };
  }

  async escalateProcess(tenantId: string, instanceId: string, dto: any) {
    const instance = await prisma.bpmnProcessInstance.findFirst({
      where: { id: instanceId, tenantId },
    });
    if (!instance) throw new NotFoundException("Process instance not found");

    const history = [
      ...((instance.history as any[]) || []),
      {
        elementId: "escalation",
        type: "escalation",
        timestamp: new Date().toISOString(),
        user: dto.escalatedBy || "system",
        outcome: dto.reason || "Escalated",
      },
    ];

    return prisma.bpmnProcessInstance.update({
      where: { id: instanceId },
      data: { status: "ESCALATED", history: history as any },
    });
  }

  async importBpmnXml(tenantId: string, xml: string, options: { name?: string; key?: string } = {}) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: true,
      trimValues: true,
    });

    const parsed = parser.parse(xml);

    const definitions = parsed["bpmn:definitions"] || parsed.definitions;
    if (!definitions) {
      throw new BadRequestException("Invalid BPMN XML: missing definitions element");
    }

    const process = definitions["bpmn:process"] || definitions.process;
    if (!process) {
      throw new BadRequestException("Invalid BPMN XML: missing process element");
    }

    if (process["@_isExecutable"] !== "true") {
      throw new BadRequestException("BPMN process must be executable (isExecutable=true)");
    }

    const processId = process["@_id"] || "imported-process";
    const processName = options.name || process["@_name"] || processId;
    const processKey = options.key || processId;

    const elements: BpmnElement[] = [];
    const flows: BpmnFlow[] = [];

    const parseElements = (element: any, type: string) => {
      if (!element) return;
      const items = Array.isArray(element) ? element : [element];
      for (const item of items) {
        const el: BpmnElement = {
          id: item["@_id"],
          type: this.mapBpmnType(type),
          label: item["@_name"] || item["@_id"],
          config: {},
        };

        if (item["bpmn:extensionElements"] || item.extensionElements) {
          const ext = item["bpmn:extensionElements"] || item.extensionElements;
          if (ext["camunda:properties"] || ext.properties) {
            const props = ext["camunda:properties"] || ext.properties;
            const propArray = Array.isArray(props["camunda:property"] || props.property)
              ? props["camunda:property"] || props.property
              : [props["camunda:property"] || props.property].filter(Boolean);
            for (const prop of propArray) {
              if (el.config) {
                el.config[prop["@_name"]] = prop["@_value"];
              }
            }
          }
        }

        const diKey = Object.keys(item).find(k => k.includes("BPMNShape") || k.includes("bpmnShape"));
        if (diKey) {
          const bounds = item[diKey]["dc:Bounds"] || item[diKey].bounds;
          if (bounds) {
            el.x = parseFloat(bounds["@_x"] || bounds.x);
            el.y = parseFloat(bounds["@_y"] || bounds.y);
            el.width = parseFloat(bounds["@_width"] || bounds.width);
            el.height = parseFloat(bounds["@_height"] || bounds.height);
          }
        }

        elements.push(el);
      }
    };

    parseElements(process["bpmn:startEvent"], "startEvent");
    parseElements(process["bpmn:endEvent"], "endEvent");
    parseElements(process["bpmn:userTask"], "userTask");
    parseElements(process["bpmn:serviceTask"], "serviceTask");
    parseElements(process["bpmn:scriptTask"], "scriptTask");
    parseElements(process["bpmn:exclusiveGateway"], "exclusiveGateway");
    parseElements(process["bpmn:parallelGateway"], "parallelGateway");
    parseElements(process["bpmn:inclusiveGateway"], "inclusiveGateway");
    parseElements(process["bpmn:timerEvent"], "timerEvent");
    parseElements(process["bpmn:boundaryEvent"], "boundaryEvent");
    parseElements(process["bpmn:intermediateCatchEvent"], "intermediateCatchEvent");
    parseElements(process["bpmn:intermediateThrowEvent"], "intermediateThrowEvent");

    const sequenceFlows = process["bpmn:sequenceFlow"] || process.sequenceFlow;
    if (sequenceFlows) {
      const flowArray = Array.isArray(sequenceFlows) ? sequenceFlows : [sequenceFlows];
      for (const flow of flowArray) {
        flows.push({
          id: flow["@_id"],
          from: flow["@_sourceRef"],
          to: flow["@_targetRef"],
          conditionExpression: flow["bpmn:conditionExpression"]?.["#text"] || flow.conditionExpression,
        });
      }
    }

    const existing = await prisma.bpmnProcessDefinition.findFirst({
      where: { tenantId, key: processKey },
    });
    if (existing) {
      throw new BadRequestException(`A process with key "${processKey}" already exists`);
    }

    return prisma.bpmnProcessDefinition.create({
      data: {
        tenantId,
        name: processName,
        key: processKey,
        description: `Imported from BPMN XML (${new Date().toISOString()})`,
        elements: elements as any,
        flows: flows as any,
        slaConfig: {},
        settings: {},
      },
    });
  }

  async exportBpmnXml(tenantId: string, processId: string) {
    const proc = await prisma.bpmnProcessDefinition.findFirst({
      where: { id: processId, tenantId },
    });
    if (!proc) throw new NotFoundException("BPMN process not found");

    const elements = (proc.elements as unknown as BpmnElement[]) || [];
    const flows = (proc.flows as unknown as BpmnFlow[]) || [];

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: true,
      indentBy: "  ",
      suppressEmptyNode: true,
    });

    const processElements: any[] = [];

    for (const el of elements) {
      const bpmnType = this.mapInternalTypeToBpmn(el.type);
      const elementObj: any = {
        [`bpmn:${bpmnType}`]: {
          "@_id": el.id,
          "@_name": el.label || el.id,
        },
      };

      if (el.config && Object.keys(el.config).length > 0) {
        elementObj[`bpmn:${bpmnType}`]["bpmn:extensionElements"] = {
          "camunda:properties": {
            "camunda:property": Object.entries(el.config).map(([name, value]) => ({
              "@_name": name,
              "@_value": String(value),
            })),
          },
        };
      }

      processElements.push(elementObj);
    }

    for (const flow of flows) {
      const flowObj: any = {
        "bpmn:sequenceFlow": {
          "@_id": flow.id,
          "@_sourceRef": flow.from,
          "@_targetRef": flow.to,
        },
      };
      if (flow.conditionExpression) {
        flowObj["bpmn:sequenceFlow"]["bpmn:conditionExpression"] = {
          "@_xsi:type": "bpmn:tFormalExpression",
          "#text": flow.conditionExpression,
        };
      }
      processElements.push(flowObj);
    }

    const bpmnXml = {
      "bpmn:definitions": {
        "@_xmlns:bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
        "@_xmlns:bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
        "@_xmlns:dc": "http://www.omg.org/spec/DD/20100524/DC",
        "@_xmlns:di": "http://www.omg.org/spec/DD/20100524/DI",
        "@_xmlns:camunda": "http://camunda.org/schema/1.0/bpmn",
        "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "@_id": "Definitions_1",
        "@_targetNamespace": "http://bpmn.io/schema/bpmn",
        "bpmn:process": {
          "@_id": proc.key,
          "@_isExecutable": "true",
          "@_name": proc.name,
          ...Object.fromEntries(processElements.map(e => {
            const k = Object.keys(e)[0];
            return k ? [k, (e as any)[k]] : null;
          }).filter(Boolean) as [string, any][]),
        },
        "bpmndi:BPMNDiagram": {
          "@_id": "BPMNDiagram_1",
          "bpmndi:BPMNPlane": {
            "@_id": "BPMNPlane_1",
            "@_bpmnElement": proc.key,
            "bpmndi:BPMNShape": elements.map(el => ({
              "@_id": `${el.id}_di`,
              "@_bpmnElement": el.id,
              "dc:Bounds": {
                "@_x": el.x || 100,
                "@_y": el.y || 100,
                "@_width": el.width || 100,
                "@_height": el.height || 80,
              },
            })),
            "bpmndi:BPMNEdge": flows.map(flow => ({
              "@_id": `${flow.id}_di`,
              "@_bpmnElement": flow.id,
              "di:waypoint": [
                { "@_x": 0, "@_y": 0 },
                { "@_x": 100, "@_y": 100 },
              ],
            })),
          },
        },
      },
    };

    return builder.build(bpmnXml);
  }

  async executeBpmnProcess(tenantId: string, processId: string, variables: Record<string, any> = {}, startedBy?: string) {
    const proc = await prisma.bpmnProcessDefinition.findFirst({
      where: { id: processId, tenantId },
    });
    if (!proc) throw new NotFoundException("BPMN process not found");

    const elements = (proc.elements as unknown as BpmnElement[]) || [];
    const flows = (proc.flows as unknown as BpmnFlow[]) || [];

    const instance = await prisma.bpmnProcessInstance.create({
      data: {
        tenantId,
        definitionId: processId,
        variables: variables as any,
        currentElements: [] as any,
        startedBy: startedBy || null,
        status: "RUNNING",
      },
    });

    const startElements = elements.filter(e => e.type === "startEvent");
    const activeElementIds: string[] = [];

    for (const startEl of startElements) {
      await prisma.bpmnActivityInstance.create({
        data: {
          tenantId,
          instanceId: instance.id,
          elementId: startEl.id,
          elementType: startEl.type,
          label: startEl.label || "Start",
          assignedTo: startedBy || null,
          status: "ACTIVE",
          startedAt: new Date(),
        },
      });
      activeElementIds.push(startEl.id);
    }

    await prisma.bpmnProcessInstance.update({
      where: { id: instance.id },
      data: { currentElements: activeElementIds as any },
    });

    return { instanceId: instance.id, activeElements: activeElementIds };
  }

  async advanceBpmnInstance(tenantId: string, instanceId: string, completedElementId: string, outcome: string, variables: Record<string, any> = {}) {
    const instance = await prisma.bpmnProcessInstance.findFirst({
      where: { id: instanceId, tenantId },
      include: { definition: true },
    });
    if (!instance) throw new NotFoundException("Process instance not found");

    const elements = (instance.definition.elements as unknown as BpmnElement[]) || [];
    const flows = (instance.definition.flows as unknown as BpmnFlow[]) || [];

    const completedActivity = await prisma.bpmnActivityInstance.findFirst({
      where: { instanceId, elementId: completedElementId, status: "ACTIVE" },
    });
    if (completedActivity) {
      await prisma.bpmnActivityInstance.update({
        where: { id: completedActivity.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          outcome,
          variables: variables as any,
        },
      });
    }

    const currentElements = (instance.currentElements as string[]) || [];
    const newCurrentElements = currentElements.filter(id => id !== completedElementId);

    const outgoingFlows = flows.filter(f => f.from === completedElementId);
    let nextElementIds: string[] = [];

    for (const flow of outgoingFlows) {
      const targetElement = elements.find(e => e.id === flow.to);
      if (!targetElement) continue;

      let shouldTake = true;
      if (flow.conditionExpression) {
        shouldTake = this.evaluateCondition(flow.conditionExpression, { ...(instance.variables as any), ...variables });
      }

      if (shouldTake) {
        if (targetElement.type === "exclusiveGateway" || targetElement.type === "parallelGateway" || targetElement.type === "inclusiveGateway") {
          const gatewayOutgoing = flows.filter(f => f.from === targetElement.id);
          let gatewayNext: string[] = [];
          for (const gFlow of gatewayOutgoing) {
            const gTarget = elements.find(e => e.id === gFlow.to);
            if (!gTarget) continue;
            let gShouldTake = true;
            if (gFlow.conditionExpression) {
              gShouldTake = this.evaluateCondition(gFlow.conditionExpression, { ...(instance.variables as any), ...variables });
            }
            if (gShouldTake) {
              if (gTarget.type === "endEvent") {
                gatewayNext.push(gTarget.id);
              } else {
                gatewayNext.push(gTarget.id);
              }
            }
          }
          nextElementIds.push(...gatewayNext);
        } else if (targetElement.type === "endEvent") {
          nextElementIds.push(targetElement.id);
        } else {
          nextElementIds.push(targetElement.id);
        }
      }
    }

    for (const nextElId of nextElementIds) {
      const nextEl = elements.find(e => e.id === nextElId);
      if (!nextEl) continue;

      await prisma.bpmnActivityInstance.create({
        data: {
          tenantId,
          instanceId,
          elementId: nextEl.id,
          elementType: nextEl.type,
          label: nextEl.label || nextEl.type,
          assignedTo: nextEl.type === "userTask" ? null : "system",
          status: nextEl.type === "endEvent" ? "COMPLETED" : "ACTIVE",
          startedAt: new Date(),
          completedAt: nextEl.type === "endEvent" ? new Date() : null,
          outcome: nextEl.type === "endEvent" ? "completed" : null,
        },
      });

      if (nextEl.type !== "endEvent") {
        newCurrentElements.push(nextEl.id);
      }
    }

    const isComplete = nextElementIds.some(id => {
      const el = elements.find(e => e.id === id);
      return el?.type === "endEvent";
    });

    const status = isComplete && newCurrentElements.length === 0 ? "COMPLETED" : "RUNNING";

    const mergedVariables = { ...(instance.variables as any), ...variables };

    await prisma.bpmnProcessInstance.update({
      where: { id: instanceId },
      data: {
        currentElements: newCurrentElements as any,
        variables: mergedVariables as any,
        status,
        completedAt: status === "COMPLETED" ? new Date() : undefined,
      },
    });

    return { instanceId, status, currentElements: newCurrentElements };
  }

  private mapBpmnType(type: string): string {
    const map: Record<string, string> = {
      startEvent: "startEvent",
      endEvent: "endEvent",
      userTask: "userTask",
      serviceTask: "serviceTask",
      scriptTask: "scriptTask",
      exclusiveGateway: "exclusiveGateway",
      parallelGateway: "parallelGateway",
      inclusiveGateway: "inclusiveGateway",
      timerEvent: "timerEvent",
      boundaryEvent: "boundaryEvent",
      intermediateCatchEvent: "intermediateCatchEvent",
      intermediateThrowEvent: "intermediateThrowEvent",
    };
    return map[type] || type;
  }

  private mapInternalTypeToBpmn(type: string): string {
    const map: Record<string, string> = {
      startEvent: "startEvent",
      endEvent: "endEvent",
      userTask: "userTask",
      serviceTask: "serviceTask",
      scriptTask: "scriptTask",
      exclusiveGateway: "exclusiveGateway",
      parallelGateway: "parallelGateway",
      inclusiveGateway: "inclusiveGateway",
      timerEvent: "timerEvent",
      boundaryEvent: "boundaryEvent",
      intermediateCatchEvent: "intermediateCatchEvent",
      intermediateThrowEvent: "intermediateThrowEvent",
    };
    return map[type] || type;
  }

  private evaluateCondition(expression: string, variables: Record<string, any>): boolean {
    try {
      // Handle BPMN condition expressions like ${approved == true} or ${amount > 100}
      // Extract the expression inside ${...} and evaluate it with variables as context
      const expr = expression
        .replace(/\$\{([^}]+)\}/g, (_, innerExpr) => {
          // Replace variable names in the inner expression with their values
          let evaluated = innerExpr;
          for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`\\b${key}\\b`, 'g');
            if (typeof value === "string") {
              evaluated = evaluated.replace(regex, `"${value}"`);
            } else {
              evaluated = evaluated.replace(regex, String(value));
            }
          }
          return evaluated;
        })
        .replace(/==/g, "===")
        .replace(/!=/g, "!==");

      return new Function("vars", `with (vars) { return ${expr}; }`)(variables);
    } catch {
      return false;
    }
  }
}
