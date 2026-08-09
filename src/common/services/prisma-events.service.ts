import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@kannan19302/database";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AppLogger } from "./logger.service";

@Injectable()
export class PrismaEventsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext("PrismaEventsService");
  }

  onModuleInit() {
    this.logger.log("Registering Prisma Event Emitter middleware...");
    this.logger.warn("Prisma $use is removed. Event emission is temporarily disabled.");
    
    // Prisma 5/6 removes $use. Need to migrate this to Prisma Client Extensions.
    /*
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.prisma as any).$use(async (params: any, next: (params: any) => Promise<any>) => {
      const result = await next(params);
      
      const { model, action } = params;
      
      if (model && (action === "create" || action === "update" || action === "delete")) {
        const eventName = `${model.toLowerCase()}.${action}`;
        
        try {
          this.eventEmitter.emit(eventName, {
            model,
            action,
            data: result,
          });
          this.logger.debug(`Emitted event: ${eventName}`);
        } catch (error) {
          this.logger.error(`Failed to emit event: ${eventName}`, error instanceof Error ? error.stack : undefined);
        }
      }
      
      return result;
    });
    */
  }
}
