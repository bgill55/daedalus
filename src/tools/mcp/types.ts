// MCP Client - Transport abstraction

export interface MCPTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: any): Promise<void>;
  sendAndWait(message: any): Promise<any>;
  listTools(): Promise<any[]>;
  callTool(name: string, args: any): Promise<any>;
  onMessage(handler: (message: any) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
}

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}