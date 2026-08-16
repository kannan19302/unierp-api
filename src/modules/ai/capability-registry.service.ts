import { Injectable, Logger } from '@nestjs/common';

export interface PlatformCapability {
  platformId: string; // e.g. 'unierp-tenant-admin', 'unierp-web-studio'
  tools: string[]; // List of tool names available to this platform
  allowedMutations: string[]; // Allowed actions without explicit approval
}

@Injectable()
export class CapabilityRegistryService {
  private readonly logger = new Logger(CapabilityRegistryService.name);
  
  // In-memory registry for now. Could be moved to DB for dynamic capabilities.
  private readonly capabilities = new Map<string, PlatformCapability>();

  registerPlatform(capability: PlatformCapability) {
    this.logger.log(`Registering capabilities for platform: ${capability.platformId}`);
    this.capabilities.set(capability.platformId, capability);
  }

  getPlatformCapabilities(platformId: string): PlatformCapability | undefined {
    return this.capabilities.get(platformId);
  }

  canExecuteTool(platformId: string, toolName: string): boolean {
    const caps = this.capabilities.get(platformId);
    if (!caps) return false;
    return caps.tools.includes(toolName);
  }
}
