import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TelemetryData } from '../types.js';
import type { WebuiChatMessageEvent, WebuiChatRequest, FileNode } from './types.js';

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

export type ChatHandler = (message: string, broadcast: (evt: WebuiChatMessageEvent) => void) => Promise<void>;

let activeChatHandler: ChatHandler | null = null;

export function registerChatHandler(handler: ChatHandler | null): void {
  activeChatHandler = handler;
}

export function broadcastChatEvent(evt: WebuiChatMessageEvent): void {
  const payload = `data: ${JSON.stringify(evt)}\n\n`;
  for (const client of activeClientRecords) {
    try {
      client.res.write(payload);
    } catch {
      // client disconnected
    }
  }
}

const TREE_ALWAYS_IGNORE = new Set([
  'node_modules', '.git', 'dist', '.daedalus', 'coverage',
  '.nyc_output', '__pycache__', '.next', '.cache', '.turbo', 'build',
]);

function parseGitignore(cwd: string): Set<string> {
  const ignored = new Set<string>();
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return ignored;
  const lines = fs.readFileSync(gitignorePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    ignored.add(line.replace(/^\//, '').replace(/\/$/, ''));
  }
  return ignored;
}

function getProjectTree(dir: string, cwd: string, depth: number, gitignored: Set<string>): FileNode[] {
  if (depth > 4) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (TREE_ALWAYS_IGNORE.has(entry.name)) continue;
    const relPath = path.relative(cwd, path.join(dir, entry.name)).replace(/\\/g, '/');
    if (gitignored.has(entry.name) || gitignored.has(relPath)) continue;
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        type: 'dir',
        path: relPath,
        children: getProjectTree(path.join(dir, entry.name), cwd, depth + 1, gitignored),
      });
    } else {
      nodes.push({ name: entry.name, type: 'file', path: relPath });
    }
  }
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function parseJsonBody<T = any>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function handleChatRequest(req: IncomingMessage, res: ServerResponse): void {
  parseJsonBody<WebuiChatRequest>(req)
    .then(async data => {
      const message = data.message?.trim();
      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message content is required' }));
        return;
      }

      broadcastChatEvent({
        type: 'chat_token',
        role: 'user',
        text: message,
        timestamp: Date.now(),
      });

      if (!activeChatHandler) {
        broadcastChatEvent({
          type: 'chat_token',
          role: 'assistant',
          text: `[Daedalus WebUI] Echo: "${message}". (Interactive agent execution bridge ready)`,
          timestamp: Date.now(),
        });
        broadcastChatEvent({
          type: 'chat_done',
          timestamp: Date.now(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', handled: 'echo' }));
        return;
      }

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'running' }));

      try {
        await activeChatHandler(message, broadcastChatEvent);
      } catch (err: any) {
        broadcastChatEvent({
          type: 'chat_error',
          content: err.message || 'Chat processing error',
          timestamp: Date.now(),
        });
      }
    })
    .catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Invalid JSON body' }));
    });
}

export function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  try {
    if (req.method === 'POST' && req.url === '/api/chat') {
      handleChatRequest(req, res);
      return;
    }

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

    if (req.method === 'GET' && (req.url === '/styles.css' || req.url === '/script.js' || req.url === '/marked.min.js' || req.url === '/favicon.svg' || req.url === '/favicon.ico')) {
      const filename = req.url.slice(1);
      const assetPath = resolvePublicAsset(filename);
      if (assetPath) {
        const mimeTypes: Record<string, string> = {
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.svg': 'image/svg+xml; charset=utf-8',
          '.ico': 'image/x-icon',
        };
        const ext = path.extname(assetPath);
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(assetPath));
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

    if (req.method === 'GET' && req.url === '/api/files') {
      const cwd = process.cwd();
      const gitignored = parseGitignore(cwd);
      const tree = getProjectTree(cwd, cwd, 0, gitignored);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cwd: path.basename(cwd), tree }));
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
