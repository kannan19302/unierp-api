import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";

export interface SupplyChainEventPayload {
  tenantId: string;
  entityId: string;
  [key: string]: unknown;
}

@Injectable()
export class SupplyChainEventsService {
  @OnEvent("asn.received")
  handleAsnReceived(payload: SupplyChainEventPayload) {
    // Scoped to payload.tenantId
  }

  @OnEvent("shipment.delivered")
  handleShipmentDelivered(payload: SupplyChainEventPayload) {
    // Scoped to payload.tenantId
  }

  @OnEvent("vendor-return.shipped")
  handleVendorReturnShipped(payload: SupplyChainEventPayload) {
    // Scoped to payload.tenantId
  }

  @OnEvent("cross-dock.order.completed")
  handleCrossDockCompleted(payload: SupplyChainEventPayload) {
    // Scoped to payload.tenantId
  }
}
