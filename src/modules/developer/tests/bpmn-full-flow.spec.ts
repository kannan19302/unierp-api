import { BuilderBpmnService } from "../services/builder-bpmn.service";
import { vi, describe, it, expect, beforeEach } from "vitest";

const createMockPrisma = () => ({
  bpmnProcessDefinition: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "bpmn-1" }),
    update: vi.fn().mockResolvedValue({ id: "bpmn-1" }),
    delete: vi.fn().mockResolvedValue({ id: "bpmn-1" }),
    count: vi.fn().mockResolvedValue(0),
  },
  bpmnTimerDefinition: {
    create: vi.fn().mockResolvedValue({ id: "timer-1" }),
  },
  bpmnProcessInstance: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "inst-1" }),
    update: vi.fn().mockResolvedValue({ id: "inst-1" }),
    count: vi.fn().mockResolvedValue(0),
  },
  bpmnActivityInstance: {
    create: vi.fn().mockResolvedValue({ id: "act-1" }),
    findFirst: vi.fn().mockResolvedValue({ id: "act-1", status: "ACTIVE" }),
    update: vi.fn().mockResolvedValue({ id: "act-1" }),
  },
});

vi.mock("@kannan19302/database", () => ({
  get prisma() {
    return mockPrisma;
  },
}));

let mockPrisma: ReturnType<typeof createMockPrisma>;

describe("BuilderBpmnService - Full BPMN 2.0 Flow", () => {
  let service: BuilderBpmnService;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new BuilderBpmnService();
    vi.clearAllMocks();
  });

  it("imports BPMN XML, executes process, and advances through gateway", async () => {
    // Step 1: Import BPMN XML
    mockPrisma.bpmnProcessDefinition.findFirst.mockResolvedValue(null);
    mockPrisma.bpmnProcessDefinition.create.mockResolvedValue({ 
      id: "imported-1",
      key: "order-approval",
      name: "Order Approval Process",
      elements: [],
      flows: [],
    });

    const bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="OrderApproval" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="ReviewTask" name="Review Order">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="DecisionGateway">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Approved</bpmn:outgoing>
      <bpmn:outgoing>Flow_Rejected</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="ReviewTask" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="ReviewTask" targetRef="DecisionGateway" />
    <bpmn:sequenceFlow id="Flow_Approved" sourceRef="DecisionGateway" targetRef="EndApproved">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved == true}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_Rejected" sourceRef="DecisionGateway" targetRef="EndRejected">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved == false}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:endEvent id="EndApproved">
      <bpmn:incoming>Flow_Approved</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="EndRejected">
      <bpmn:incoming>Flow_Rejected</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="OrderApproval">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="173" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ReviewTask_di" bpmnElement="ReviewTask">
        <dc:Bounds x="259" y="87" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="DecisionGateway_di" bpmnElement="DecisionGateway">
        <dc:Bounds x="409" y="107" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndApproved_di" bpmnElement="EndApproved">
        <dc:Bounds x="509" y="62" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndRejected_di" bpmnElement="EndRejected">
        <dc:Bounds x="509" y="182" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const imported = await service.importBpmnXml("tenant-1", bpmnXml, { 
      name: "Order Approval Process", 
      key: "order-approval" 
    });
    expect(imported).toBeDefined();
    expect(mockPrisma.bpmnProcessDefinition.create).toHaveBeenCalled();

    // Step 2: Verify the imported process has the right elements and flows
    const createCall = mockPrisma.bpmnProcessDefinition.create.mock.calls[0][0];
    const importedElements = createCall.data.elements as any[];
    const importedFlows = createCall.data.flows as any[];
    
    expect(importedElements.length).toBeGreaterThanOrEqual(5); // start, userTask, gateway, 2 endEvents
    expect(importedFlows.length).toBeGreaterThanOrEqual(4); // 4 sequence flows
    
    const elementTypes = importedElements.map(e => e.type).sort();
    expect(elementTypes).toContain("startEvent");
    expect(elementTypes).toContain("userTask");
    expect(elementTypes).toContain("exclusiveGateway");
    expect(elementTypes).toContain("endEvent");

    // Step 3: Execute the process
    mockPrisma.bpmnProcessDefinition.findFirst.mockResolvedValue({
      id: imported.id,
      key: "order-approval",
      name: "Order Approval Process",
      elements: importedElements,
      flows: importedFlows,
    });
    mockPrisma.bpmnProcessInstance.create.mockResolvedValue({ id: "inst-1" });
    mockPrisma.bpmnActivityInstance.create.mockResolvedValue({ id: "act-1" });

    const executeResult = await service.executeBpmnProcess("tenant-1", imported.id, { orderId: "ORD-123" }, "user-1");
    expect(executeResult).toHaveProperty("instanceId");
    expect(executeResult.activeElements).toContain("StartEvent_1");

    // Step 4: Advance through the user task (approve)
    mockPrisma.bpmnProcessInstance.findFirst.mockResolvedValue({
      id: "inst-1",
      definitionId: imported.id,
      variables: { orderId: "ORD-123" },
      currentElements: ["ReviewTask"],
      status: "RUNNING",
      definition: {
        id: imported.id,
        elements: importedElements,
        flows: importedFlows,
      },
    });
    mockPrisma.bpmnActivityInstance.findFirst.mockResolvedValue({ id: "act-1", status: "ACTIVE" });
    mockPrisma.bpmnActivityInstance.update.mockResolvedValue({ id: "act-1" });
    mockPrisma.bpmnActivityInstance.create.mockResolvedValue({ id: "act-2" });
    mockPrisma.bpmnProcessInstance.update.mockResolvedValue({ id: "inst-1" });

    const advanceResult = await service.advanceBpmnInstance("tenant-1", "inst-1", "ReviewTask", "approved", { approved: true });
    expect(advanceResult).toHaveProperty("instanceId");
    expect(advanceResult).toHaveProperty("status");
    expect(mockPrisma.bpmnActivityInstance.create).toHaveBeenCalled();

    // Step 5: Verify export works
    mockPrisma.bpmnProcessDefinition.findFirst.mockResolvedValue({
      id: imported.id,
      key: "order-approval",
      name: "Order Approval Process",
      elements: importedElements,
      flows: importedFlows,
      slaConfig: {},
      settings: {},
    });

    const exportedXml = await service.exportBpmnXml("tenant-1", imported.id);
    expect(typeof exportedXml).toBe("string");
    expect(exportedXml).toContain("bpmn:definitions");
    expect(exportedXml).toContain("order-approval"); // process ID is the key
    expect(exportedXml).toContain("ReviewTask");
    expect(exportedXml).toContain("DecisionGateway");
  });
});