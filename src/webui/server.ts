import { createServer, IncomingMessage, ServerResponse } from 'node:http';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3888;
const HOST = 'localhost';

export interface TelemetryData {
  timestamp: number;
  metric: string;
  value: number;
}

export function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath, 'utf8'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (req.method === 'GET' && req.url === '/telemetry') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection message
    res.write('data: {"type":"connected"}\n\n');

    // Generate and send dummy telemetry data every second
    const interval = setInterval(() => {
      const data: TelemetryData = {
        timestamp: Date.now(),
        metric: ['cpu', 'memory', 'disk', 'network'][Math.floor(Math.random() * 4)],
        value: Math.floor(Math.random() * 100)
      };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }, 1000);

    // Clean up interval on client disconnect
    req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

const server = createServer(handleRequest);

export function startServer(port = PORT, host = HOST) {
  return server.listen(port, host, () => {
    console.info(`[webui] Server listening on http://${host}:${port}`);
  });
}

export { server, PORT, HOST };
