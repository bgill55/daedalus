import { StdioTransport } from './src/tools/mcp/stdio.js';

async function main() {
  const transport = new StdioTransport({
    name: 'sequential-thinking',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    enabled: true,
  });

  console.log('Connecting...');
  const start = Date.now();
  try {
    await transport.connect();
    console.log(`Connected in ${Date.now() - start}ms`);
    const tools = await transport.listTools();
    console.log('Tools:', JSON.stringify(tools, null, 2));
    await transport.disconnect();
  } catch (err) {
    console.error(`Failed after ${Date.now() - start}ms:`, err);
  }
  process.exit(0);
}

main();
