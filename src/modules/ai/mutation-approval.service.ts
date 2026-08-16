import { Injectable, Logger } from '@nestjs/common';

export interface MutationRequest {
  id: string;
  tenantId: string;
  userId: string;
  tool: string;
  payload: any;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: Date;
}

@Injectable()
export class MutationApprovalService {
  private readonly logger = new Logger(MutationApprovalService.name);
  private readonly requests = new Map<string, MutationRequest>();

  requestApproval(tenantId: string, userId: string, tool: string, payload: any): MutationRequest {
    const id = Math.random().toString(36).substring(7);
    const request: MutationRequest = {
      id,
      tenantId,
      userId,
      tool,
      payload,
      status: 'pending',
      requestedAt: new Date()
    };
    
    this.requests.set(id, request);
    this.logger.log(`Created mutation approval request ${id} for tool ${tool}`);
    return request;
  }

  approve(id: string): boolean {
    const request = this.requests.get(id);
    if (!request) return false;
    
    request.status = 'approved';
    this.logger.log(`Approved mutation request ${id}`);
    return true;
  }

  reject(id: string): boolean {
    const request = this.requests.get(id);
    if (!request) return false;
    
    request.status = 'rejected';
    this.logger.log(`Rejected mutation request ${id}`);
    return true;
  }
}
