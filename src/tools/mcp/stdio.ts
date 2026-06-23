// MCP Stdio Transport

import { spawn, ChildProcess } from 'child_process';
import { MCPTransport, MCPServerConfig } from './types.js';
import { createRequire } from 'module';
const _req = createRequire(import.meta.url);
const { version: CLI_VERSION } = _req('../../../package.json');

const SENSITIVE_ENV_KEYS = new Set([
  'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID',
  'GITHUB_TOKEN', 'GIT_TOKEN', 'NPM_TOKEN',
  'DATABASE_URL', 'DB_URL', 'MONGODB_URI', 'MYSQL_URL', 'PGURL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY',
  'HF_TOKEN', 'HUGGINGFACE_TOKEN',
]);

const BLOCKED_ENV_KEYS = new Set([
  'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES',
]);

function sanitizeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (BLOCKED_ENV_KEYS.has(key)) continue;
    if (SENSITIVE_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }
  return env;
}

export class StdioTransport implements MCPTransport {
  private process: ChildProcess | null = null;
  private messageHandler: ((message: any) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private buffer = '';
  private requestId = 0;
  private pendingRequests = new Map<number, (response: any) => void>();
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.command) {
      throw new Error('Stdio transport requires command');
    }

    // Validate command — no shell metacharacters or path traversal
    if (/[;&|`$(){}<>!]/.test(this.config.command)) {
      throw new Error(`MCP stdio command rejected: "${this.config.command}" contains shell metacharacters`);
    }

    this.process = spawn(this.config.command, this.config.args || [], {
      env: sanitizeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[MCP:${this.config.name}] stderr: ${data.toString()}`);
    });

    this.process.on('error', (err: Error) => {
      this.errorHandler?.(err);
    });

    this.process.on('close', () => {
      this.closeHandler?.();
    });

    // Initialize connection
    await this.send({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'daedalus-cli', version: CLI_VERSION },
      },
    });

    // Wait for initialized response
    await this.waitForResponse('initialize');
    
    // Send initialized notification
    await this.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    // List tools
    await this.listTools();
    return;
  }

  private nextId(): number {
    return ++this.requestId;
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch {
        console.error(`[MCP:${this.config.name}] Failed to parse: ${line}`);
      }
    }
  }

  private handleMessage(message: any): void {
    // Response to a request
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const resolver = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      resolver(message);
      return;
    }

    // Notification or unsolicited response
    this.messageHandler?.(message);
  }

  private waitForResponse(method: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.messageHandler = originalHandler;
        reject(new Error(`Timeout waiting for ${method}`));
      }, 10000);

      const originalHandler = this.messageHandler;
      this.messageHandler = (msg: any) => {
        if (msg.method === method || (msg.id && msg.result)) {
          clearTimeout(timeout);
          this.messageHandler = originalHandler;
          resolve(msg);
        } else if (originalHandler) {
          originalHandler(msg);
        }
      };
    });
  }

  async send(message: any): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Process not connected');
    }
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  async sendAndWait(message: any): Promise<any> {
    const id = this.nextId();
    const msgWithId = { ...message, id };
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, resolve);
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
      
      this.send(msgWithId);
    });
  }

  async listTools(): Promise<any[]> {
    const response = await this.sendAndWait({
      jsonrpc: '2.0',
      method: 'tools/list',
    });
    return response.result?.tools || [];
  }

  async callTool(name: string, args: any): Promise<any> {
    const response = await this.sendAndWait({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}