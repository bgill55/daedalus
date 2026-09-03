import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TelemetryData } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3888;
const HOST = '127.0.0.1';

let telemetryIntervalMs = 1000;

interface ActiveClientRecord {
  res: ServerResponse;
  intervalId: NodeJS.Timeout;
}

const activeClientRecords = new Set<ActiveClientRecord>();

export function getTelemetryRate(): number {
  return telemetryIntervalMs;
}

export function setTelemetryRate(ms: number): number {
  telemetryIntervalMs = Math.max(100, Math.min(60000, ms));
  // Reschedule active client intervals dynamically
  for (const record of activeClientRecords) {
    clearInterval(record.intervalId);
    record.intervalId = setInterval(() => {
      sendTelemetryMetric(record.res);
    }, telemetryIntervalMs);
  }
  return telemetryIntervalMs;
}

function sendTelemetryMetric(res: ServerResponse) {
  try {
    const data: TelemetryData = {
      timestamp: Date.now(),
      metric: ['cpu', 'memory', 'disk', 'network'][Math.floor(Math.random() * 4)],
      value: Math.floor(Math.random() * 100),
    };
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { /* client disconnected */ }
}

function resolvePublicAsset(filename: string): string | null {
  const primary = path.join(__dirname, 'public', filename);
  if (fs.existsSync(primary)) return primary;

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
        'Access-Control-Allow-Origin': '*',
      });

      res.write('data: {"type":"connected"}\n\n');

      const clientRecord: ActiveClientRecord = {
        res,
        intervalId: null as any,
      };

      clientRecord.intervalId = setInterval(() => {
        sendTelemetryMetric(res);
      }, telemetryIntervalMs);

      activeClientRecords.add(clientRecord);

      req.on('close', () => {
        clearInterval(clientRecord.intervalId);
        activeClientRecords.delete(clientRecord);
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

export function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const lines = out.split('\n').filter(l => l.includes('LISTENING'));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && parseInt(pid, 10) !== process.pid) {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
        }
      }
    } else {
      execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'ignore' });
    }
  } catch {
    // best-effort cleanup
  }
}

let server: Server = createServer(handleRequest);

export function startServer(port = PORT, host = HOST): Promise<Server> {
  return new Promise((resolve, reject) => {
    server = createServer(handleRequest);

    const errorHandler = (err: any) => {
      if (err.code === 'EADDRINUSE') {
        try {
          killProcessOnPort(port);
          setTimeout(() => {
            server = createServer(handleRequest);
            server.once('error', reject);
            server.listen(port, host, () => {
              server.removeListener('error', reject);
              resolve(server);
            });
          }, 300);
          return;
        } catch {
          reject(err);
        }
      } else {
        reject(err);
      }
    };

    server.once('error', errorHandler);
    server.listen(port, host, () => {
      server.removeListener('error', errorHandler);
      console.info(`[webui] Server listening on http://${host}:${port}`);
      resolve(server);
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const record of activeClientRecords) {
      try {
        clearInterval(record.intervalId);
        record.res.end();
      } catch {
        // ignore client termination error
      }
    }
    activeClientRecords.clear();

    if (!server || !server.listening) {
      resolve();
      return;
    }

    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Auto-cleanup on CLI exit
process.on('exit', () => {
  if (server && server.listening) {
    try {
      server.close();
    } catch { /* best-effort */ }
  }
});

export { server, PORT, HOST };
