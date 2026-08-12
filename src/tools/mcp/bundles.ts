export interface McpBundle {
  name: string;
  description: string;
  servers: Array<{
    name: string;
    command: string;
    args?: string[];
    description: string;
  }>;
}

export const MCP_BUNDLES: readonly McpBundle[] = [
  {
    name: 'web-dev',
    description: 'Web development toolkit: GitHub repo management & PostgreSQL database access',
    servers: [
      {
        name: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        description: 'GitHub issues, pull requests, and repository file operations',
      },
      {
        name: 'postgres',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        description: 'PostgreSQL schema inspection and SQL queries',
      },
    ],
  },
  {
    name: 'cloud',
    description: 'Cloud infrastructure & payments: Google Cloud Storage/BigQuery & Stripe API',
    servers: [
      {
        name: 'gcp',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-gcp'],
        description: 'Google Cloud Platform resource management',
      },
      {
        name: 'stripe',
        command: 'npx',
        args: ['-y', '@stripe/mcp'],
        description: 'Stripe payments and subscription APIs',
      },
    ],
  },
  {
    name: 'data-science',
    description: 'Data analytics & memory: BigQuery engine & MemPalace knowledge graph',
    servers: [
      {
        name: 'bigquery',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-bigquery'],
        description: 'BigQuery data warehouse queries',
      },
      {
        name: 'mempalace',
        command: 'npx',
        args: ['-y', 'mempalace'],
        description: 'Knowledge graph persistent memory',
      },
    ],
  },
] as const;

export function listMcpBundles(): readonly McpBundle[] {
  return MCP_BUNDLES;
}

export function getMcpBundle(name: string): McpBundle | undefined {
  return MCP_BUNDLES.find(b => b.name.toLowerCase() === name.toLowerCase());
}
