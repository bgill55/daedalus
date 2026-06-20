// MCP Registry - manages multiple MCP server connections

import { MCPServerConfig, MCPTool, MCPTransport } from './types.js';
import { StdioTransport } from './stdio.js';
import { HttpTransport } from './http.js';
import { ToolDefinition } from '../../tools/definitions.js';

export class MCPRegistry {
  private transports = new Map<string, MCPTransport>();
  private tools = new Map<string, MCPTool>(); // prefixedName -> tool
  private serverConfigs: MCPServerConfig[] = [];

  setConfigs(configs: MCPServerConfig[]): void {
    this.serverConfigs = configs.filter(c => c.enabled);
  }

  async connectAll(): Promise<void> {
    const connections = this.serverConfigs.map(async (config) => {
      try {
        await this.connectServer(config);
      } catch (err: any) {
        console.error(`[MCP] Failed to connect to ${config.name}: ${err.message}`);
      }
    });
    await Promise.all(connections);
  }

  private async connectServer(config: MCPServerConfig): Promise<void> {
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

    // Discover tools
    const tools = await transport.listTools();
    for (const tool of tools) {
      const prefixedName = `mcp_${config.name}_${tool.name}`;
      this.tools.set(prefixedName, { ...tool, name: prefixedName });
    }

    console.log(`[MCP] Connected to ${config.name} (${tools.length} tools)`);
  }

  async callTool(prefixedName: string, args: any): Promise<any> {
    // Extract server name from prefix: mcp_<server>_<tool>
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
        console.error(`[MCP] Error disconnecting ${name}:`, err);
      }
    }
    this.transports.clear();
    this.tools.clear();
  }
}

// Singleton instance
export const mcpRegistry = new MCPRegistry();