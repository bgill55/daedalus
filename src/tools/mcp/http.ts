// MCP HTTP/SSE Transport
// Uses native Node.js fetch + ReadableStream for SSE — no EventSource polyfill needed.

import { MCPTransport, MCPServerConfig } from './types.js';

class SSEClient {
  private url: string;
  private abortController = new AbortController();
  private handlers = new Map<string, ((event: { data: string }) => void)[]>();
  private _readyState: number = 0; // 0=connecting, 1=open, 2=closed

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  get readyState() { return this._readyState; }

  private async connect() {
    try {
      const response = await fetch(this.url, {
        signal: this.abortController.signal,
        headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error(`SSE HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');
      this._readyState = 1;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n');
        buffer = parts.pop() || '';

        let data = '';
        for (const line of parts) {
          if (line.startsWith('data: ')) {
            data += line.slice(6);
          } else if (line === '' && data) {
            this.dispatch('message', { data });
            data = '';
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.dispatch('error', { data: err.message });
      }
    } finally {
      this._readyState = 2;
    }
  }

  private dispatch(type: string, event: { data: string }) {
    const handlers = this.handlers.get(type);
    if (handlers) handlers.forEach(h => h(event));
  }

  get onmessage() { return (this.handlers.get('message')?.[0]) ?? null; }
  set onmessage(handler: ((event: { data: string }) => void) | null) {
    if (handler) this.handlers.set('message', [handler]);
    else this.handlers.delete('message');
  }

  get onerror() { return (this.handlers.get('error')?.[0]) ?? null; }
  set onerror(handler: ((event: { data: string }) => void) | null) {
    if (handler) this.handlers.set('error', [handler]);
    else this.handlers.delete('error');
  }

  close() {
    this.abortController.abort();
    this._readyState = 2;
  }
}

export class HttpTransport implements MCPTransport {
  private config: MCPServerConfig;
  private messageHandler: ((message: any) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private sseClient: SSEClient | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, (response: any) => void>();

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error('HTTP transport requires url');
    }

    this.sseClient = new SSEClient(this.config.url);

    this.sseClient.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch {
        console.error(`[MCP:${this.config.name}] Failed to parse SSE: ${event.data.slice(0, 200)}`);
      }
    };

    this.sseClient.onerror = (event) => {
      this.errorHandler?.(new Error(event.data || 'SSE connection error'));
    };

    await this.sendPOST({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'daedalus-cli', version: '0.1.0' },
      },
    });

    await this.sendPOST({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  private nextId(): number {
    return ++this.requestId;
  }

  private handleMessage(message: any): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const resolver = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      resolver(message);
      return;
    }
    this.messageHandler?.(message);
  }

  private async sendPOST(message: any): Promise<any> {
    if (!this.config.url) throw new Error('Not connected');

    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    return res.json();
  }

  async send(message: any): Promise<void> {
    await this.sendPOST(message);
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

      this.sendPOST(msgWithId);
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

  onClose(_handler: () => void): void {
    // SSE auto-reconnects; close detection would need heartbeat
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  async disconnect(): Promise<void> {
    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }
  }
}
