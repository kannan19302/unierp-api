import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

export interface RuntimeCellPlacement { cellId: string; shard: number; region: string; topologyVersion: string }
/** Deterministic routing contract. The default is intentionally local and
 * stateless; a control-plane placement registry can override this service
 * later without changing runtime manifest consumers. */
@Injectable()
export class RuntimeCellRouterService {
  place(tenantId: string, options?: { cellCount?: number; region?: string }): RuntimeCellPlacement {
    const cellCount = options?.cellCount ?? 64; const region = options?.region ?? "default";
    const hash = createHash("sha256").update(`unierp-runtime-cell/v1:${tenantId}`).digest();
    const shard = hash.readUInt32BE(0) % cellCount;
    return { cellId: `${region}-cell-${shard.toString().padStart(2, "0")}`, shard, region, topologyVersion: "unierp.cells/v1" };
  }
}
