import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { startWebSocketServer, broadcastMilestone, closeWebSocketServer, getWebSocketClientsCount } from './ws.js';

describe('WebSocket Server & Milestone Push Notifications (M-7)', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    server = http.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          port = addr.port;
        }
        resolve();
      });
    });
    startWebSocketServer(server);
  });

  afterEach(async () => {
    closeWebSocketServer();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('starts WebSocket server on the same HTTP port and accepts client connections', async () => {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    expect(getWebSocketClientsCount()).toBe(1);
    ws.close();
  });

  it('broadcasts milestone push notification events to connected clients', async () => {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    const messagePromise = new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        const data = JSON.parse(raw.toString());
        resolve(data);
      });
    });

    broadcastMilestone({
      id: 'm-7',
      title: 'Milestone push notifications via WebSocket',
      status: 'passed',
      score: 95,
      summary: 'Test notification received',
    });

    const msg = await messagePromise;
    expect(msg.type).toBe('milestone');
    expect(msg.id).toBe('m-7');
    expect(msg.title).toBe('Milestone push notifications via WebSocket');
    expect(msg.score).toBe(95);

    // Client mock notification verification
    const notifications: Array<{ title: string; options: any }> = [];
    const mockNotification = (title: string, options: any) => {
      notifications.push({ title, options });
    };

    if (msg.type === 'milestone') {
      mockNotification(`[DAEDALUS] ${msg.title}`, { body: msg.summary });
    }

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('Milestone push notifications');
    expect(notifications[0].options.body).toBe('Test notification received');

    ws.close();
  });
});
