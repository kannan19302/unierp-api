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

describe("BuilderBpmnService - Import/Export/Execute", () => {
  let service: BuilderBpmnService;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new BuilderBpmnService();
    vi.clearAllMocks();
  });

  it("importBpmnXml method exists", () => {
    expect(typeof service.importBpmnXml).toBe("function");
  });

  it("exportBpmnXml method exists", () => {
    expect(typeof service.exportBpmnXml).toBe("function");
  });

  it("executeBpmnProcess method exists", () => {
    expect(typeof service.executeBpmnProcess).toBe("function");
  });

  it("advanceBpmnInstance method exists", () => {
    expect(typeof service.advanceBpmnInstance).toBe("function");
  });

  it("importBpmnXml parses simple process", async () => {
    mockPrisma.bpmnProcessDefinition.findFirst.mockResolvedValue(null);
    mockPrisma.bpmnProcessDefinition.create.mockResolvedValue({ id: "imported-1" });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1">
      <bpmn:outgoing>SequenceFlow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="UserTask_1" name="Review Order">
      <bpmn:incoming>SequenceFlow_1</bpmn:incoming>
      <bpmn:outgoing>SequenceFlow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="ExclusiveGateway_1">
      <bpmn:incoming>SequenceFlow_2</bpmn:incoming>
      <bpmn:outgoing>SequenceFlow_3</bpmn:outgoing>
      <bpmn:outgoing>SequenceFlow_4</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="SequenceFlow_1" sourceRef="StartEvent_1" targetRef="UserTask_1" />
    <bpmn:sequenceFlow id="SequenceFlow_2" sourceRef="UserTask_1" targetRef="ExclusiveGateway_1" />
    <bpmn:sequenceFlow id="SequenceFlow_3" sourceRef="ExclusiveGateway_1" targetRef="EndEvent_1">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved == true}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SequenceFlow_4" sourceRef="ExclusiveGateway_1" targetRef="EndEvent_2">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved == false}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:endEvent id="EndEvent_1">
      <bpmn:incoming>SequenceFlow_3</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="EndEvent_2">
      <bpmn:incoming>SequenceFlow_4</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="173" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="UserTask_1_di" bpmnElement="UserTask_1">
        <dc:Bounds x="259" y="87" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ExclusiveGateway_1_di" bpmnElement="ExclusiveGateway_1">
        <dc:Bounds x="409" y="107" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="509" y="62" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_2_di" bpmnElement="EndEvent_2">
        <dc:Bounds x="509" y="182" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="SequenceFlow_1_di" bpmnElement="SequenceFlow_1">
        <di:waypoint x="209" y="120" />
        <di:waypoint x="259" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SequenceFlow_2_di" bpmnElement="SequenceFlow_2">
        <di:waypoint x="359" y="120" />
        <di:waypoint x="409" y="132" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SequenceFlow_3_di" bpmnElement="SequenceFlow_3">
        <di:waypoint x="434" y="107" />
        <di:waypoint x="509" y="80" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SequenceFlow_4_di" bpmnElement="SequenceFlow_4">
        <di:waypoint x="434" y="157" />
        <di:waypoint x="509" y="200" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const result = await service.importBpmnXml("t1", xml, { name: "Test Process", key: "test-process" });
    expect(result).toBeDefined();
    expect(mockPrisma.bpmnProcessDefinition.create).toHaveBeenCalled();
  });

  it("importBpmnXml rejects non-executable process", async () => {
    mockPrisma.bpmnProcessDefinition.findFirst.mockResolvedValue(null);
    mockPrisma.bpmnProcessDefinition.create.mockResolvedValue({ id: "imported-1" });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
</bpmn:definitions>`;

    await expect(service.importBpmnXml("t1", xml)).rejects.toThrow("must be executable");
  });

  it("executeBpmnProcess creates instance with start events", async () => {
    mockPrisma.bpmnProcessDefinition.findFirst.mockResolvedValue({
      id: "bpmn-1",
      elements: [{ id: "start1", type: "startEvent", label: "Start" }],
    });
    mockPrisma.bpmnProcessInstance.create.mockResolvedValue({ id: "inst-1" });
    mockPrisma.bpmnActivityInstance.create.mockResolvedValue({ id: "act-1" });

    const result = await service.executeBpmnProcess("t1", "bpmn-1", { foo: "bar" }, "user-1");
    expect(result).toHaveProperty("instanceId");
    expect(result).toHaveProperty("activeElements");
  });

  it("advanceBpmnInstance advances through gateway", async () => {
    mockPrisma.bpmnProcessInstance.findFirst.mockResolvedValue({
      id: "inst-1",
      definitionId: "bpmn-1",
      variables: { approved: true },
      currentElements: ["task1"],
      status: "RUNNING",
      definition: {
        id: "bpmn-1",
        elements: [
          { id: "start1", type: "startEvent", label: "Start" },
          { id: "task1", type: "userTask", label: "Review" },
          { id: "gw1", type: "exclusiveGateway", label: "Gateway" },
          { id: "end1", type: "endEvent", label: "End Approved" },
          { id: "end2", type: "endEvent", label: "End Rejected" },
        ],
        flows: [
          { id: "f1", from: "start1", to: "task1" },
          { id: "f2", from: "task1", to: "gw1" },
          { id: "f3", from: "gw1", to: "end1", conditionExpression: "${approved == true}" },
          { id: "f4", from: "gw1", to: "end2", conditionExpression: "${approved == false}" },
        ],
      },
    });
    mockPrisma.bpmnActivityInstance.findFirst.mockResolvedValue({ id: "act-1", status: "ACTIVE" });
    mockPrisma.bpmnActivityInstance.update.mockResolvedValue({ id: "act-1" });
    mockPrisma.bpmnActivityInstance.create.mockResolvedValue({ id: "act-2" });
    mockPrisma.bpmnProcessInstance.update.mockResolvedValue({ id: "inst-1" });

    const result = await service.advanceBpmnInstance("t1", "inst-1", "task1", "approved", { approved: true });
    expect(result).toHaveProperty("instanceId");
    expect(result).toHaveProperty("status");
    expect(mockPrisma.bpmnActivityInstance.create).toHaveBeenCalled();
  });
});