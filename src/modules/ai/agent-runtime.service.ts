import { Injectable, Logger } from '@nestjs/common';
import { AiAgentService, AgentConverseMessage, AgentConverseResult } from './ai-agent.service';

export interface AgentTask {
  goal: string;
  context?: Record<string, any>;
}

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(private readonly agentService: AiAgentService) {}

  async executeTask(
    tenantId: string,
    userId: string,
    task: AgentTask
  ): Promise<AgentConverseResult> {
    this.logger.log(`Executing task for tenant ${tenantId}, user ${userId}: ${task.goal}`);
    
    // Setup the initial prompt for the autonomous agent execution
    const history: AgentConverseMessage[] = [
      {
        role: 'user',
        content: `Please accomplish the following task: ${task.goal}\nContext: ${JSON.stringify(task.context || {})}`
      }
    ];

    // Delegate to the conversational AI loop to execute tools
    // In a mature setup, this would be an iterative planner-executor loop
    return this.agentService.converse(tenantId, userId, history);
  }
}
