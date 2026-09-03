import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TelemetryData } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3888;
const HOST = '127.0.0.1';

const activeClients = new Set<ServerResponse>();

function resolvePublicAsset(filename: string): string | null {
  const primary = path.join(__dirname, 'public', filename);
  if (fs.existsSync(primary)) return primary;

  // Fallback for development / uncompiled runner environments
  const fallback = path.join(__dirname, '..', '..', 'src', 'webui', 'public', filename);
  if (fs.existsSync(fallback)) return fallback;

  return null;
}

export function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  try {
    if (req.method === 'GET' && req.url === '/') {
      const htmlPath = resolvePublicAsset('index.html');
      if (htmlPath) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(htmlPath, 'utf8'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    if (req.method === 'GET' && req.url === '/styles.css') {
      const cssPath = resolvePublicAsset('styles.css');
      if (cssPath) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(fs.readFileSync(cssPath, 'utf8'));
        return;
      }
    }

    if (req.method === 'GET' && req.url === '/script.js') {
      const jsPath = resolvePublicAsset('script.js');
      if (jsPath) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(fs.readFileSync(jsPath, 'utf8'));
        return;
      }
    }

    if (req.method === 'GET' && req.url === '/telemetry') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      res.write('data: {"type":"connected"}\n\n');
      activeClients.add(res);

      const interval = setInterval(() => {
        const data: TelemetryData = {
          timestamp: Date.now(),
          metric: ['cpu', 'memory', 'disk', 'network'][Math.floor(Math.random() * 4)],
          value: Math.floor(Math.random() * 100)
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }, 1000);

      req.on('close', () => {
        clearInterval(interval);
        activeClients.delete(res);
        res.end();
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err?.message || 'Internal Server Error' }));
  }
}

const server: Server = createServer(handleRequest);

export function startServer(port = PORT, host = HOST): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      console.info(`[webui] Server listening on http://${host}:${port}`);
      resolve(server);
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const client of activeClients) {
      try {
        client.end();
      } catch {
        // ignore client termination error
      }
    }
    activeClients.clear();

    if (!server.listening) {
      resolve();
      return;
    }

    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export { server, PORT, HOST };
