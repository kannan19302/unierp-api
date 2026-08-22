import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { RuntimePlanCacheService } from "./runtime-plan-cache.service";

const CHANNEL = "unierp:developer-runtime-plan:invalidate:v1";

type RedisClient = Pick<Redis, "connect" | "disconnect" | "publish" | "subscribe" | "on">;

/** Broadcasts emergency cache invalidations to every runtime cell. Local
 * eviction is always performed first, so Redis degradation never extends the
 * emergency window on the calling cell. Messages are intentionally tenant-only
 * and contain no release, source, binding, or secret data. */
@Injectable()
export class RuntimePlanCacheInvalidationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimePlanCacheInvalidationService.name);
  private publisher?: RedisClient;
  private subscriber?: RedisClient;

  constructor(private readonly cache: RuntimePlanCacheService, clients?: { publisher: RedisClient; subscriber: RedisClient }) {
    this.publisher = clients?.publisher;
    this.subscriber = clients?.subscriber;
  }

  async onModuleInit() {
    if (!this.publisher || !this.subscriber) {
      const options = { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false };
      this.publisher = new Redis(process.env.REDIS_URL || "redis://localhost:6379", options);
      this.subscriber = new Redis(process.env.REDIS_URL || "redis://localhost:6379", options);
    }
    this.publisher.on("error", (error) => this.logger.warn(`Runtime cache invalidation publisher unavailable: ${error.message}`));
    this.subscriber.on("error", (error) => this.logger.warn(`Runtime cache invalidation subscriber unavailable: ${error.message}`));
    this.subscriber.on("message", (channel: string, body: string) => {
      if (channel !== CHANNEL) return;
      try {
        const event = JSON.parse(body);
        if (typeof event?.tenantId === "string" && event.tenantId.length > 0 && event.tenantId.length <= 256) this.cache.invalidateTenant(event.tenantId);
      } catch { /* malformed external messages are ignored */ }
    });
    try {
      await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
      await this.subscriber.subscribe(CHANNEL);
    } catch (error) {
      this.logger.warn(`Runtime cache cross-cell invalidation is degraded: ${(error as Error).message}`);
    }
  }

  async invalidateTenant(tenantId: string) {
    this.cache.invalidateTenant(tenantId);
    try { await this.publisher?.publish(CHANNEL, JSON.stringify({ tenantId })); }
    catch (error) { this.logger.warn(`Could not broadcast runtime cache invalidation: ${(error as Error).message}`); }
  }

  onModuleDestroy() {
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
  }
}
