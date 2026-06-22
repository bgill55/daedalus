# Model Context Protocol (MCP) Integration

Daedalus supports the Model Context Protocol (MCP), enabling you to extend the AI agent's capability by connecting external tools, resource templates, and prompt templates.

---

## Configuring MCP Servers

MCP servers are configured in `~/.daedalus/config.json` under `"tools.mcpServers"`. Daedalus supports both `stdio` (local process spawning) and `http` (SSE-based remote endpoints) transports.

```json
{
  "tools": {
    "mcpServers": {
      "github": {
        "transport": "stdio",
        "command": "node",
        "args": ["C:/Users/brica/AppData/Roaming/npm/node_modules/@modelcontextprotocol/server-github/dist/index.js"],
        "enabled": true
      },
      "memory-palace": {
        "transport": "http",
        "url": "http://localhost:3000/sse",
        "headers": {
          "Authorization": "Bearer my-secret-token"
        },
        "enabled": true
      }
    }
  }
}
```

### Configuration Schema

For each server entry, the configuration schema supports:

*   **`transport`**: Select `"stdio"` or `"http"`.
*   **`enabled`**: Set to `true` to connect to the server on CLI startup.
*   **`command`** *(stdio only)*: The executable command to spawn (e.g., `"node"`, `"python"`, `"docker"`).
*   **`args`** *(stdio only)*: Arguments to pass to the executable command.
*   **`url`** *(http only)*: The HTTP/SSE server endpoint URL (e.g., `http://localhost:3000/sse`).
*   **`headers`** *(http only)*: Optional HTTP headers to include in the connection request.

---

## MCP Server Manager Commands

Daedalus includes a built-in MCP server manager that lets you discover, install, and manage servers directly from the REPL. It queries the [Official MCP Registry](https://registry.modelcontextprotocol.io) — no API key required.

| Command | Description |
|---------|-------------|
| `/mcp search <query>` | Search the official registry for MCP servers |
| `/mcp install <name>` | Install a server (adds it to your Daedalus config) |
| `/mcp list` | Show installed servers with connection status |
| `/mcp remove <name>` | Remove a server from your config |
| `/mcp info <name>` | Show server details, endpoints, and required env vars |
| `/mcp enable <name>` | Enable a disabled server |
| `/mcp disable <name>` | Disable a server without removing it |

### Example workflow

```
/mcp search github
/mcp info ai.ankimcp/anki-mcp-server
/mcp install ai.ankimcp/anki-mcp-server
/mcp list
```

### How it works

When you run `/mcp install`, the manager:
1. Fetches the latest server metadata from the official registry
2. Converts it to a Daedalus-compatible config (stdio for npm/pip packages, http for remote endpoints)
3. Writes the entry to `~/.daedalus/config.json`
4. The server will be loaded on next startup (or after reconnecting)

Servers installed via `/mcp` can also be managed manually in `~/.daedalus/config.json` under `tools.mcpServers`.

---

## Tool Capabilities & Routing

*   **Registration**: On startup, Daedalus connects to all enabled MCP servers in parallel, discovers their tools, and registers them as native agent tools. Connections are fire-and-forget — the REPL prompt appears immediately without waiting for MCP initialization to complete.
*   **Trust Guardrail**: Registered MCP tools are subject to the same user consent gate as built-in tools. The CLI will output a permission request and require user approval before executing any MCP tool call on your behalf.
*   **Capability Filtering**: If a sub-agent requires MCP tools, the router automatically filters and delegates tasks to model endpoints configured with `"supportsTools": true`.
