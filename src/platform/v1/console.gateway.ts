import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger, UseGuards } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { verifyToken } from "@kannan19302/auth";

@WebSocketGateway({ namespace: "/console", cors: { origin: "*" } })
export class ConsoleGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ConsoleGateway.name);

  @WebSocketServer()
  server!: Server;

  // Provider admins don't necessarily need a strict tenant map if they are superadmins,
  // but we can track active socket connections.
  private providerSockets = new Set<string>();

  handleConnection(client: Socket) {
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace("Bearer ", "");
    
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const decoded = verifyToken(token) as {
        userId?: string;
        roles?: string[];
      } | null;
      
      // Ensure the user has the superadmin role required for provider console
      if (!decoded || !decoded.roles?.includes("superadmin")) {
        this.logger.warn(`Unauthorized connection attempt to ConsoleGateway`);
        client.disconnect();
        return;
      }

      (client as any).userId = decoded.userId;
      
      this.providerSockets.add(client.id);
      
      this.logger.log(`Provider Admin ${decoded.userId} connected to console namespace`);
    } catch (e) {
      this.logger.error("Failed to verify token on WebSocket connection", e);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.providerSockets.delete(client.id);
    this.logger.log(`Provider Admin disconnected from console namespace`);
  }

  @SubscribeMessage("ping")
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit("pong", { timestamp: new Date().toISOString() });
  }

  /**
   * Broadcast an event to all connected provider admins in the console
   */
  broadcastToAdmins(event: string, data: any) {
    this.server?.emit(event, data);
  }

  /**
   * Broadcast specific entity updates (e.g. tenant created/updated)
   */
  emitTenantUpdate(data: any) {
    this.server?.emit("tenant:update", data);
  }

  /**
   * Listen for Prisma data events and broadcast to admins
   * so the console UI can perform real-time CRUD updates.
   */
  @OnEvent("*.*")
  handlePrismaEvent(payload: { model: string; action: string; data: any }) {
    if (payload && payload.model && payload.action) {
      // E.g., 'tenant.create', 'tenant.update', 'domain.create'
      const eventName = `${payload.model.toLowerCase()}.${payload.action.toLowerCase()}`;
      this.broadcastToAdmins(eventName, payload.data);
    }
  }
}
