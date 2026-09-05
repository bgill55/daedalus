import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TelemetryData } from '../types.js';
import type { WebuiChatMessageEvent, WebuiChatRequest, FileNode } from './types.js';
import { loadProfile } from '../profile.js';
import { generateQrCode, getWebSocketUrl } from './qr.js';

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

let prevCpus = os.cpus();

function getCpuPercent(): number {
  const currentCpus = os.cpus();
  let totalDiff = 0;
  let idleDiff = 0;
  for (let i = 0; i < currentCpus.length; i++) {
    const prev = prevCpus[i]?.times || { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const curr = currentCpus[i]?.times || { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    totalDiff += (curr.user + curr.nice + curr.sys + curr.idle + curr.irq) - (prev.user + prev.nice + prev.sys + prev.idle + prev.irq);
    idleDiff += (curr.idle - prev.idle);
  }
  prevCpus = currentCpus;
  if (totalDiff <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
}

function getMemoryPercent(): number {
  const total = os.totalmem();
  const free = os.freemem();
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((total - free) / total) * 100)));
}

let metricIndex = 0;
const metricNames = ['cpu', 'memory', 'disk', 'network'] as const;

function sendTelemetryMetric(res: ServerResponse) {
  try {
    const metric = metricNames[metricIndex % metricNames.length];
    metricIndex++;
    let value = 0;
    if (metric === 'cpu') {
      value = getCpuPercent();
    } else if (metric === 'memory') {
      value = getMemoryPercent();
    } else if (metric === 'disk') {
      const memUsage = process.memoryUsage();
      value = Math.min(100, Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100));
    } else {
      value = Math.min(100, Math.round((process.uptime() % 60) * 1.5));
    }

    const data: TelemetryData = {
      timestamp: Date.now(),
      metric,
      value,
    };
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { /* client disconnected */ }
}

export function getTelemetryRate(): number {
  return telemetryIntervalMs;
}

export function setTelemetryRate(ms: number): number {
  telemetryIntervalMs = Math.max(100, Math.min(60000, ms));
  for (const record of activeClientRecords) {
    clearInterval(record.intervalId);
    record.intervalId = setInterval(() => {
      sendTelemetryMetric(record.res);
    }, telemetryIntervalMs);
  }
  return telemetryIntervalMs;
}

export type HistoryProvider = () => Array<{ role: string; text: string }>;
export type ContextFilesProvider = {
  getFiles: () => string[];
  removeFile: (file: string) => boolean;
};

export interface SessionItem {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  turns_count?: number;
}

export interface SessionProvider {
  listSessions: () => SessionItem[];
  resumeSession: (id: string) => Promise<boolean>;
  newSession: () => Promise<string>;
  deleteSession: (id: string) => Promise<boolean>;
}

export interface ModelProvider {
  getActiveModel: () => string;
  getAvailableModels: () => Array<{ id: string; name: string; provider?: string }>;
  switchModel: (model: string) => Promise<boolean>;
}

let activeHistoryProvider: HistoryProvider | null = null;
let activeContextFilesProvider: ContextFilesProvider | null = null;
let activeSessionProvider: SessionProvider | null = null;
let activeModelProvider: ModelProvider | null = null;

export function registerHistoryProvider(provider: HistoryProvider | null): void {
  activeHistoryProvider = provider;
}

export function registerContextFilesProvider(provider: ContextFilesProvider | null): void {
  activeContextFilesProvider = provider;
}

export function registerSessionProvider(provider: SessionProvider | null): void {
  activeSessionProvider = provider;
}

export function registerModelProvider(provider: ModelProvider | null): void {
  activeModelProvider = provider;
}

function resolvePublicAsset(filename: string): string | null {
  const primary = path.join(__dirname, 'public', filename);
  if (fs.existsSync(primary)) return primary;

  const fallback = path.join(__dirname, '..', '..', 'src', 'webui', 'public', filename);
  if (fs.existsSync(fallback)) return fallback;

  return null;
}

export type ChatHandler = (request: WebuiChatRequest, broadcast: (evt: WebuiChatMessageEvent) => void) => Promise<void>;

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
      if (body.length > 10 * 1024 * 1024) {
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
      if (!message && !data.imageBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message or image content is required' }));
        return;
      }

      broadcastChatEvent({
        type: 'chat_token',
        role: 'user',
        text: message || 'Attached image',
        imageBase64: data.imageBase64,
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
        await activeChatHandler(data, broadcastChatEvent);
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

    if (req.method === 'GET' && req.url === '/api/history') {
      const history = activeHistoryProvider ? activeHistoryProvider() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ history }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/context') {
      const files = activeContextFilesProvider ? activeContextFilesProvider.getFiles() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
      return;
    }

    if (req.method === 'DELETE' && req.url === '/api/context') {
      parseJsonBody<{ file: string }>(req)
        .then(data => {
          const removed = activeContextFilesProvider && data.file ? activeContextFilesProvider.removeFile(data.file) : false;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ removed }));
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Invalid JSON' }));
        });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/sessions') {
      const sessions = activeSessionProvider ? activeSessionProvider.listSessions() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/sessions/resume') {
      parseJsonBody<{ sessionId: string }>(req)
        .then(async data => {
          if (!activeSessionProvider || !data.sessionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing sessionId or provider' }));
            return;
          }
          const success = await activeSessionProvider.resumeSession(data.sessionId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, sessionId: data.sessionId }));
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Invalid JSON' }));
        });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/sessions/new') {
      (async () => {
        if (!activeSessionProvider) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session provider not available' }));
          return;
        }
        const sessionId = await activeSessionProvider.newSession();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, sessionId }));
      })().catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Failed to create session' }));
      });
      return;
    }

    if (req.method === 'DELETE' && req.url === '/api/sessions') {
      parseJsonBody<{ sessionId: string }>(req)
        .then(async data => {
          if (!activeSessionProvider || !data.sessionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing sessionId or provider' }));
            return;
          }
          const success = await activeSessionProvider.deleteSession(data.sessionId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, sessionId: data.sessionId }));
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Invalid JSON' }));
        });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/models') {
      const activeModel = activeModelProvider ? activeModelProvider.getActiveModel() : 'auto';
      const availableModels = activeModelProvider ? activeModelProvider.getAvailableModels() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ activeModel, availableModels }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/profile') {
      const profile = loadProfile();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: profile.name || '', bio: profile.bio || '', style: profile.style || '' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/models/switch') {
      parseJsonBody<{ model: string }>(req)
        .then(async data => {
          if (!activeModelProvider || !data.model) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing model name or provider' }));
            return;
          }
          const success = await activeModelProvider.switchModel(data.model);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, activeModel: data.model }));
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Invalid JSON' }));
        });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/qr') {
      const wsUrl = getWebSocketUrl(HOST, PORT);
      generateQrCode(wsUrl)
        .then(buf => {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(buf);
        })
        .catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'QR generation failed' }));
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
