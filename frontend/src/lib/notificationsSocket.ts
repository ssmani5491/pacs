// Authenticated notification socket (Phase 8, Module B). Connects to the backend
// Socket.IO gateway on /ws/notifications, passing the access token + identity in
// the handshake. On any 'notification' event it calls onNotification so the bell
// can refresh. If the socket can't connect, the bell still works via polling.
import { io, Socket } from 'socket.io-client';
import { getAccess } from './api';

interface Me { organizationId?: string | null; roles?: string[] }

export function connectNotifications(onNotification: (n: any) => void): Socket | null {
  const token = getAccess();
  if (!token) return null;
  // Identity claims for room membership (server only emits to owning rooms).
  let me: Me = {};
  try { me = JSON.parse(localStorage.getItem('pacs_me') ?? '{}'); } catch { /* ignore */ }

  try {
    const socket = io('/ws/notifications', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token, organizationId: me.organizationId ?? null, roles: me.roles ?? [] },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
    });
    socket.on('notification', (n: any) => onNotification(n));
    // On (re)connect, trigger a refresh so anything missed during a drop is reconciled.
    socket.on('connect', () => onNotification({ _reconnect: true }));
    return socket;
  } catch {
    return null;
  }
}
