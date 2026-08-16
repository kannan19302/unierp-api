import { Injectable, Logger } from '@nestjs/common';

export interface AiAuditLogEntry {
  timestamp: Date;
  tenantId: string;
  userId: string;
  platformId: string;
  action: 'tool_execution' | 'mutation_requested' | 'mutation_approved' | 'mutation_rejected';
  details: Record<string, any>;
}

@Injectable()
export class AiAuditService {
  private readonly logger = new Logger(AiAuditService.name);

  log(entry: Omit<AiAuditLogEntry, 'timestamp'>) {
    const fullEntry: AiAuditLogEntry = {
      ...entry,
      timestamp: new Date()
    };
    
    // In a real implementation this would write to a pg vector store or audit log table
    this.logger.log(`[AI AUDIT] Tenant: ${entry.tenantId} | User: ${entry.userId} | Action: ${entry.action}`, JSON.stringify(fullEntry.details));
  }
}
