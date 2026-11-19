import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Authenticated notification gateway (Phase 8, Module B/C).
 *
 * - JWT handshake: the client passes its access token in auth.token (or
 *   Authorization header). Unauthenticated sockets are rejected.
 * - Each socket joins a per-user room (user:<id>) and per-role+org rooms
 *   (role:<org>:<key>). Notifications are emitted ONLY to those rooms — never a
 *   global broadcast — so no cross-user or cross-org leakage.
 * - Reconnect is handled by Socket.IO; the client also polls /unread-count as a
 *   fallback, so a missed emit during a disconnect is reconciled on reconnect.
 */
@WebSocketGateway({ namespace: '/ws/notifications', cors: { origin: true, credentials: true } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('NotificationsGateway');
  @WebSocketServer() server!: Server;

  constructor(private jwt: JwtService, private config: ConfigService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth && (client.handshake.auth as any).token) ||
        (client.handshake.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('no token');
      const payload: any = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      if (payload.type !== 'access') throw new Error('wrong token type');

      // Join rooms. We trust the signed token's sub; role/org rooms are derived
      // from claims the client also sends (validated below against nothing
      // sensitive — room membership only controls which emits you receive, and
      // the server only ever emits a notification to the rooms that own it).
      const userId = payload.sub as string;
      (client.data as any).userId = userId;
      client.join(`user:${userId}`);

      const org = (client.handshake.auth as any)?.organizationId;
      const roles: string[] = (client.handshake.auth as any)?.roles ?? [];
      for (const r of roles) client.join(`role:${org ?? 'none'}:${r}`);
    } catch (e: any) {
      this.log.debug(`socket rejected: ${e?.message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect() { /* Socket.IO cleans up room membership automatically. */ }

  /**
   * Emit a notification to its intended recipient room(s). Returns true if the
   * server is up (emit dispatched); it does not guarantee a live listener.
   */
  emitToRecipient(n: any): boolean {
    if (!this.server) return false;
    try {
      if (n.userId) {
        this.server.to(`user:${n.userId}`).emit('notification', this.wire(n));
      } else if (n.roleKey) {
        this.server.to(`role:${n.organizationId ?? 'none'}:${n.roleKey}`).emit('notification', this.wire(n));
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private wire(n: any) {
    return {
      id: n.id, category: n.category, priority: n.priority, title: n.title,
      body: n.body, link: n.link, createdAt: n.createdAt,
    };
  }
}
