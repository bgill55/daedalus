import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export interface MilestoneNotificationPayload {
  type: 'milestone';
  id: string;
  title: string;
  status: 'passed' | 'failed' | 'in_progress';
  score?: number;
  summary?: string;
}

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function startWebSocketServer(server: Server): WebSocketServer {
  if (wss) {
    return wss;
  }

  wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  return wss;
}

export function broadcastMilestone(payload: Partial<MilestoneNotificationPayload> & { title: string }): void {
  const messageData = JSON.stringify({
    type: 'milestone',
    id: payload.id || 'm-unknown',
    title: payload.title,
    status: payload.status || 'passed',
    score: payload.score,
    summary: payload.summary,
    timestamp: Date.now(),
  });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageData);
      } catch {
        clients.delete(client);
      }
    }
  }
}

export function getWebSocketClientsCount(): number {
  return clients.size;
}

export function closeWebSocketServer(): void {
  if (wss) {
    for (const client of clients) {
      try {
        client.close();
      } catch (err) {
        console.error('[webui] Error closing client connection:', err);
      }
    }
    clients.clear();
    wss.close();
    wss = null;
  }
}
