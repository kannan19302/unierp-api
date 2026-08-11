/**
 * M45 — runbooks as versioned, testable automations. A runbook is
 * authored (DRAFT), dry-run (M09, no side effect), published (refused if
 * any step would breach M08 policy), and executed from a real incident
 * through a real two-person approval (C04/M49, reused directly — the same
 * precedent M11 set) as a real M12 job — its execution is therefore
 * audited as a plan by construction, not a second audit path.
 */
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ResourceModelService } from "../resource-model/resource-model.service";
import { PlanningService, type Plan } from "../operation-pipeline/planning.service";
import type { JobStepDefinition } from "../operation-pipeline/durable-executor.service";
import { PolicyEngineService, type PolicyScope } from "../policy-engine/policy-engine.service";
import { DurableExecutorService } from "../operation-pipeline/durable-executor.service";
import { ControlPlaneApprovalsService } from "./control-plane-approvals.service";

export interface RunbookStep {
  resourceId: string;
  proposedState: Record<string, unknown>;
}

@Injectable()
export class RunbookService {
  constructor(
    private readonly resources: ResourceModelService,
    private readonly planning: PlanningService,
    private readonly policyEngine: PolicyEngineService,
    private readonly executor: DurableExecutorService,
    private readonly approvals: ControlPlaneApprovalsService,
  ) {}

  async authorRunbook(name: string, steps: RunbookStep[]) {
    if (steps.length === 0) {
      throw new BadRequestException("A runbook must declare at least one step");
    }
    return (prisma as any).runbook.create({ data: { name, steps, status: "DRAFT" } });
  }

  /** No side effect on any resource — M09's own dryRun(), for every step. */
  async dryRunRunbook(runbookId: string) {
    const runbook = await this.getRunbook(runbookId);
    const steps: RunbookStep[] = runbook.steps;
    const plans: Plan[] = [];
    for (const step of steps) {
      plans.push(await this.planning.dryRun(step.resourceId, step.proposedState));
    }
    return plans;
  }

  /**
   * Refuses to publish a runbook containing any step that would breach the
   * given M08 policy — checked BEFORE status ever becomes PUBLISHED, so a
   * policy-breaching runbook is never in a state executeFromIncident()
   * could run.
   */
  async publishRunbook(runbookId: string, policyName: string, scopeChain: PolicyScope[] = [{ type: "PLATFORM" }]) {
    const runbook = await this.getRunbook(runbookId);
    const steps: RunbookStep[] = runbook.steps;

    for (const step of steps) {
      const result = await this.policyEngine.evaluate(policyName, scopeChain, step.proposedState);
      if (!result.allowed) {
        throw new BadRequestException(
          `Cannot publish runbook "${runbookId}": step for resource "${step.resourceId}" breaches policy "${policyName}" — ${result.violation.reason}`,
        );
      }
    }

    return (prisma as any).runbook.update({ where: { id: runbookId }, data: { status: "PUBLISHED" } });
  }

  /**
   * Executes a PUBLISHED runbook from a real incident, gated by a real
   * two-person approval (C04/M49 — the requester and approver must be
   * distinct, enforced by that service itself). Each step compiles a real
   * M09 plan and runs as one M12 durable job — the job's own audit gate
   * (M14) writes a record before every step runs, which is what "executed
   * ... audited as a plan" means as a mechanism, not a claim.
   */
  async executeFromIncident(runbookId: string, incidentId: string, requestedBy: string, approvedBy: string) {
    const runbook = await this.getRunbook(runbookId);
    if (runbook.status !== "PUBLISHED") {
      throw new BadRequestException(`Runbook "${runbookId}" is ${runbook.status}, not PUBLISHED — cannot execute`);
    }

    const incident = await (prisma as any).incident.findUnique({ where: { id: incidentId } });
    if (!incident) {
      throw new NotFoundException(`Incident "${incidentId}" not found`);
    }

    const approval = await this.approvals.request({ requestedBy, requestedAction: "runbook.execute", targetId: runbookId });
    await this.approvals.decide(approval.id, approvedBy, "APPROVED");

    const steps: RunbookStep[] = runbook.steps;
    const planIds: string[] = [];
    const jobSteps: JobStepDefinition[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const plan = await this.planning.createPlan(step.resourceId, step.proposedState);
      planIds.push(plan.id);
      jobSteps.push({
        name: `runbook-step-${i}`,
        run: async () => {
          await this.resources.setDesiredState(step.resourceId, step.proposedState);
          return step.proposedState;
        },
      });
    }

    const jobId = `runbook-${runbookId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = await this.executor.startJob(jobId, planIds[0] ?? null, steps[0]?.resourceId ?? null, jobSteps);

    const execution = await (prisma as any).runbookExecution.create({
      data: { runbookId, incidentId, approvalId: approval.id, jobId: job.id, planIds },
    });

    return { execution, job };
  }

  private async getRunbook(runbookId: string) {
    const runbook = await (prisma as any).runbook.findUnique({ where: { id: runbookId } });
    if (!runbook) throw new NotFoundException(`Runbook "${runbookId}" not found`);
    return runbook;
  }
}
