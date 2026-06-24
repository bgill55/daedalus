// MCP Registry - manages multiple MCP server connections

import { MCPServerConfig, MCPTool, MCPTransport } from './types.js';
import { StdioTransport } from './stdio.js';
import { HttpTransport } from './http.js';
import { ToolDefinition } from '../../tools/definitions.js';

export class MCPRegistry {
  private transports = new Map<string, MCPTransport>();
  private tools = new Map<string, MCPTool>();
  private serverConfigs: MCPServerConfig[] = [];

  setConfigs(configs: MCPServerConfig[]): void {
    this.serverConfigs = configs.filter(c => c.enabled);
  }

  async connectAll(): Promise<void> {
    const connections = this.serverConfigs.map(async (config) => {
      try {
        await this.connectServer(config);
      } catch (err: any) {
        console.error(`Failed to connect MCP server ${config.name}: ${err.message}`);
      }
    });
    await Promise.all(connections);
  }

  async connectServer(config: MCPServerConfig): Promise<void> {
    if (this.transports.has(config.name)) {
      console.log(`MCP server ${config.name} is already connected`);
      return;
    }

    let transport: MCPTransport;

    if (config.transport === 'stdio') {
      transport = new StdioTransport(config);
    } else if (config.transport === 'http') {
      transport = new HttpTransport(config);
    } else {
      throw new Error(`Unknown transport: ${config.transport}`);
    }

    await transport.connect();
    this.transports.set(config.name, transport);

    const tools = await transport.listTools();
    for (const tool of tools) {
      const prefixedName = `mcp_${config.name}_${tool.name}`;
      this.tools.set(prefixedName, { ...tool, name: prefixedName });
    }

    console.log(`Connected to MCP server: ${config.name} (${tools.length} tools)`);
  }

  disconnectServer(name: string): void {
    const transport = this.transports.get(name);
    if (transport) {
      transport.disconnect();
      this.transports.delete(name);
      // Remove all tools for this server
      for (const [prefixedName] of this.tools) {
        if (prefixedName.startsWith(`mcp_${name}_`)) {
          this.tools.delete(prefixedName);
        }
      }
    }
  }

  async callTool(prefixedName: string, args: any): Promise<any> {
    const match = prefixedName.match(/^mcp_([^_]+)_(.+)$/);
    if (!match) {
      throw new Error(`Invalid MCP tool name: ${prefixedName}`);
    }

    const [, serverName, toolName] = match;
    const transport = this.transports.get(serverName);

    if (!transport) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    return transport.callTool(toolName, args);
  }

  getToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const [prefixedName, tool] of this.tools) {
      defs.push({
        type: 'function',
        function: {
          name: prefixedName,
          description: `[MCP:${tool.name}] ${tool.description}`,
          parameters: tool.inputSchema,
        },
      });
    }
    return defs;
  }

  getConnectedServers(): string[] {
    return Array.from(this.transports.keys());
  }

  async disconnectAll(): Promise<void> {
    for (const [name, transport] of this.transports) {
      try {
        await transport.disconnect();
      } catch (err) {
        console.error(`Error disconnecting MCP server ${name}:`, err);
      }
    }
    this.transports.clear();
    this.tools.clear();
  }
}

export const mcpRegistry = new MCPRegistry();