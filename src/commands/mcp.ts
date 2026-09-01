import pc from 'picocolors';
import { errMessage } from '../utils/errors.js';
import type { RegistryServerEntry } from '../tools/mcp/manager.js';
import type { Command } from './types.js';

export const mcpCommand: Command = {
  name: '/mcp',
  description: 'Manage MCP servers: explore, search, install, list, remove, info',
  usage: '/mcp <subcommand> [args]',
  helpText: 'Configure and interact with Model Context Protocol (MCP) servers.\n\nSubcommands:\n  explore, ex           Browse curated featured community MCP servers\n  list, l               List all installed MCP servers and their active state\n  search, s <query>     Search the public MCP Registry for available servers\n  install, i <name>     Install an MCP server from the registry\n  remove, rm <name>     Uninstall an MCP server\n  info <name>           Display metadata and information for a registry server\n  enable <name>         Enable a configured server\n  disable <name>        Disable a configured server without removing it',
  execute: async (args, _ctx) => {
    const parts = args.trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase();
    const rest = parts.slice(1).join(' ').trim();

    const { searchRegistry, fetchServerByName, fetchAllServers, registryEntryToConfig, addServerToConfig, removeServerFromConfig, listInstalledServers, toggleServer } = await import('../tools/mcp/manager.js');
    const { mcpRegistry } = await import('../tools/mcp/registry.js');

    switch (sub) {
      case 'bundle':
      case 'b': {
        const { listMcpBundles, getMcpBundle } = await import('../tools/mcp/bundles.js');
        const bundleSub = parts[1]?.toLowerCase();
        const bundleTarget = parts[2];

        if (bundleSub === 'list' || !bundleSub) {
          console.log(pc.cyan('\n=== One-Click MCP Tool Bundles ===\n'));
          for (const b of listMcpBundles()) {
            console.log(`  ${pc.bold(b.name.padEnd(16))} ${pc.dim(b.description)}`);
            for (const s of b.servers) {
              console.log(`    ${pc.dim('•')} ${pc.cyan(s.name)}: ${s.description}`);
            }
            console.log();
          }
          console.log(pc.dim('  Install a bundle: /mcp bundle install <name>\n'));
          return;
        }

        if (bundleSub === 'install') {
          if (!bundleTarget) {
            console.log(pc.yellow('  Usage: /mcp bundle install <name>'));
            return;
          }
          const bundle = getMcpBundle(bundleTarget);
          if (!bundle) {
            console.log(pc.red(`  Bundle "${bundleTarget}" not found. Run /mcp bundle list to see presets.`));
            return;
          }
          console.log(pc.cyan(`\n  [MCP BUNDLE] Installing preset bundle: ${pc.bold(bundle.name)}...`));
          for (const s of bundle.servers) {
            addServerToConfig({ name: s.name, transport: 'stdio', command: s.command, args: s.args, enabled: true });
            console.log(pc.green(`  [OK] Installed MCP server "${s.name}"`));
          }
          console.log(pc.dim('\n  Run /mcp reconnect to activate new servers.\n'));
          return;
        }

        console.log(pc.yellow('  Usage: /mcp bundle [list | install <name>]'));
        return;
      }

      case 'search':
      case 's': {
        if (!rest) {
          console.log(pc.yellow('  Usage: /mcp search <query>'));
          return;
        }
        console.log(pc.dim(`  Searching registry for "${rest}"...`));
        try {
          const results = await searchRegistry(rest, 15);
          if (results.length === 0) {
            console.log(pc.yellow('  No servers found. Try a broader search.'));
            return;
          }
          console.log(`\n  ${pc.bold(`Found ${results.length} server(s):`)}`);
          for (const s of results) {
            const label = s.title || s.name;
            const desc = s.description.length > 80 ? s.description.slice(0, 80) + '…' : s.description;
            const remote = s.remotes?.[0]?.url || '';
            const pkg = s.packages?.[0]?.identifier || '';
            const source = remote || pkg || '(no install info)';
            const installType = s.packages ? 'stdio' : s.remotes ? 'http' : '?';
            console.log(`  ${pc.cyan(label)}`);
            console.log(`    ${pc.dim(desc)}`);
            console.log(`    ${pc.gray('Install:')} ${pc.dim(source)} (${installType})`);
            console.log();
          }
        } catch (err) {
          console.log(pc.red(`  Search failed: ${errMessage(err)}`));
        }
        return;
      }

      case 'install':
      case 'i': {
        if (!rest) {
          console.log(pc.yellow('  Usage: /mcp install <server-name>'));
          console.log(pc.dim('  First search for a server with: /mcp search <query>'));
          return;
        }
        console.log(pc.dim(`  Fetching "${rest}" from registry...`));
        try {
          const entry = await fetchServerByName(rest);
          if (!entry) {
            console.log(pc.yellow(`  Server "${rest}" not found in registry. Try /mcp search first.`));
            return;
          }
          const config = registryEntryToConfig(entry);
          if (!config) {
            console.log(pc.yellow(`  Cannot install "${rest}": no stdio package or remote URL found.`));
            return;
          }
          const result = addServerToConfig(config);
          if (result.success) {
            console.log(pc.green(`  ${result.message}`));
            console.log(pc.dim('  Restart Daedalus or reconnect to load the new server.'));
          } else {
            console.log(pc.yellow(`  ${result.message}`));
          }
        } catch (err) {
          console.log(pc.red(`  Install failed: ${errMessage(err)}`));
        }
        return;
      }

      case 'explore':
      case 'ex': {
        console.log(pc.dim('  Browsing the MCP registry...\n'));
        try {
          const all = await fetchAllServers(100);
          const local = all.filter(s => s.packages && s.packages.length > 0);
          const remote = all.filter(s => s.remotes && s.remotes.length > 0);
          console.log(`  ${pc.bold(`Found ${all.length} servers in registry`)}`);

          const showSample = (list: RegistryServerEntry[], label: string, max = 5) => {
            if (list.length === 0) return;
            console.log(`\n  ${pc.underline(label)} (${list.length} available)`);
            for (const s of list.slice(0, max)) {
              const pkg = s.packages?.[0]?.identifier || '';
              const url = s.remotes?.[0]?.url || '';
              const source = pkg || url;
              const info = s.description.length > 55 ? s.description.slice(0, 53) + '…' : s.description;
              const showName = s.name.length > 28 ? s.name.slice(0, 26) + '…' : s.name;
              console.log(`  ${pc.cyan(showName.padEnd(30))} ${pc.dim(info)}`);
              console.log(`  ${' '.repeat(30)}  ${pc.gray('→')} ${pc.dim(source)}`);
            }
            if (list.length > max) {
              console.log(`  ${' '.repeat(30)} ${pc.dim(`… and ${list.length - max} more`)}`);
            }
          };

          showSample(local, 'Local (stdio — install & run)', 6);
          showSample(remote, 'Remote (HTTP — cloud API)', 6);
          console.log(`\n  ${pc.dim('Tip: /mcp search <query> to find specific servers')}`);
        } catch (err) {
          console.log(pc.red(`  Explore failed: ${errMessage(err)}`));
        }
        return;
      }

      case 'list':
      case 'ls':
      case 'l': {
        const servers = listInstalledServers();
        if (servers.length === 0) {
          console.log(pc.yellow('  No MCP servers installed.'));
          console.log(pc.dim('  Try /mcp explore to see what\'s available.'));
          return;
        }
        const connected = mcpRegistry.getConnectedServers();
        console.log(`\n  ${pc.bold('Installed MCP Servers:')}`);
        for (const s of servers) {
          const status = connected.includes(s.name) ? pc.green('●') : s.enabled ? pc.yellow('○') : pc.red('○');
          const state = connected.includes(s.name) ? pc.green('connected')
            : s.enabled ? pc.yellow('pending')
            : pc.red('disabled');
          console.log(`  ${status} ${pc.cyan(s.name.padEnd(20))} ${pc.dim(s.transport.padEnd(6))} ${state}`);
        }
        console.log();
        return;
      }

      case 'remove':
      case 'rm':
      case 'r': {
        if (!rest) {
          console.log(pc.yellow('  Usage: /mcp remove <server-name>'));
          return;
        }
        const result = removeServerFromConfig(rest);
        if (result.success) {
          console.log(pc.green(`  ${result.message}`));
        } else {
          console.log(pc.yellow(`  ${result.message}`));
        }
        return;
      }

      case 'info': {
        if (!rest) {
          console.log(pc.yellow('  Usage: /mcp info <server-name>'));
          return;
        }
        try {
          console.log(pc.dim(`  Fetching "${rest}" from registry...`));
          const entry = await fetchServerByName(rest);
          if (!entry) {
            console.log(pc.yellow(`  Server "${rest}" not found.`));
            return;
          }
          console.log(`\n  ${pc.bold(entry.title || entry.name)}`);
          console.log(`  ${pc.dim(entry.description)}`);
          console.log(`  ${pc.gray('Name:')}    ${entry.name}`);
          console.log(`  ${pc.gray('Version:')} ${entry.version}`);
          if (entry.websiteUrl) console.log(`  ${pc.gray('Website:')} ${entry.websiteUrl}`);
          if (entry.repository?.url) console.log(`  ${pc.gray('Source:')}  ${entry.repository.url}`);

          if (entry.remotes && entry.remotes.length > 0) {
            console.log(`\n  ${pc.bold('Remote endpoints:')}`);
            for (const r of entry.remotes) {
              console.log(`    ${pc.cyan(r.type)} ${pc.dim(r.url)}`);
              if (r.headers) {
                for (const h of r.headers) {
                  const req = h.isRequired ? pc.yellow(' (required)') : '';
                  const secret = h.isSecret ? pc.dim(' [secret]') : '';
                  console.log(`      ${pc.gray('Header:')} ${h.name}${req}${secret}`);
                }
              }
            }
          }

          if (entry.packages && entry.packages.length > 0) {
            console.log(`\n  ${pc.bold('Packages:')}`);
            for (const p of entry.packages) {
              const [cmd, ...args] = p.registryType === 'npm' ? ['npx', '-y', p.identifier]
                : p.registryType === 'pypi' ? ['uvx', p.identifier]
                : [p.identifier];
              console.log(`    ${pc.cyan(p.registryType)} ${pc.dim(`${cmd} ${args.join(' ')}`)}`);
              if (p.environmentVariables) {
                for (const env of p.environmentVariables) {
                  const req = env.isRequired ? pc.yellow(' (required)') : '';
                  const secret = env.isSecret ? pc.dim(' [secret]') : '';
                  console.log(`      ${pc.gray('Env:')} ${env.name}${req}${secret}`);
                  if (env.description) console.log(`      ${pc.dim(env.description)}`);
                }
              }
            }
          }
          console.log();
        } catch (err) {
          console.log(pc.red(`  Info fetch failed: ${errMessage(err)}`));
        }
        return;
      }

      case 'reconnect':
      case 'rc': {
        const { loadConfig } = await import('../config/index.js');
        const config = loadConfig();
        const mcpConfigs = Object.entries(config.tools.mcpServers)
          .filter(([_, s]) => s.enabled)
          .map(([name, s]) => ({
            name,
            transport: s.transport,
            command: s.command,
            args: s.args,
            url: s.url,
            headers: s.headers,
            enabled: s.enabled,
          }));

        const already = mcpRegistry.getConnectedServers();
        const newServers = mcpConfigs.filter(c => !already.includes(c.name));

        if (newServers.length === 0) {
          if (mcpConfigs.length === 0) {
            console.log(pc.yellow('  No enabled MCP servers configured. Install one with /mcp install'));
          } else {
            console.log(pc.dim('  All enabled MCP servers are already connected.'));
          }
          return;
        }

        mcpRegistry.setConfigs(mcpConfigs);
        const connected: string[] = [];
        const failed: string[] = [];

        for (const s of newServers) {
          try {
            await mcpRegistry.connectServer(s);
            connected.push(s.name);
          } catch (err) {
            failed.push(`${s.name} (${errMessage(err)})`);
          }
        }

        if (connected.length > 0) {
          const totalTools = mcpRegistry.getToolDefinitions().length;
          console.log(pc.green(`  Connected: ${connected.join(', ')} (${totalTools} MCP tools total)`));
        }
        if (failed.length > 0) {
          console.log(pc.yellow(`  Failed: ${failed.join(', ')}`));
        }
        return;
      }

      case 'enable':
      case 'e': {
        if (!rest) {
          console.log(pc.yellow('  Usage: /mcp enable <server-name>'));
          return;
        }
        const enableResult = toggleServer(rest, true);
        console.log(enableResult.success ? pc.green(`  ${enableResult.message}`) : pc.yellow(`  ${enableResult.message}`));
        return;
      }

      case 'disable':
      case 'd': {
        if (!rest) {
          console.log(pc.yellow('  Usage: /mcp disable <server-name>'));
          return;
        }
        const disableResult = toggleServer(rest, false);
        console.log(disableResult.success ? pc.green(`  ${disableResult.message}`) : pc.yellow(`  ${disableResult.message}`));
        return;
      }

      default:
        console.log(pc.bold('\n  MCP Server Manager'));
        console.log(`  ${pc.cyan('/mcp explore')}           ${pc.dim('Browse available servers in the registry')}`);
        console.log(`  ${pc.cyan('/mcp search <query>')}    ${pc.dim('Search MCP registry + Smithery')}`);
        console.log(`  ${pc.cyan('/mcp install <name>')}   ${pc.dim('Install a server from the registry')}`);
        console.log(`  ${pc.cyan('/mcp list')}             ${pc.dim('List installed servers')}`);
        console.log(`  ${pc.cyan('/mcp remove <name>')}    ${pc.dim('Remove an installed server')}`);
        console.log(`  ${pc.cyan('/mcp info <name>')}      ${pc.dim('Show server details')}`);
        console.log(`  ${pc.cyan('/mcp reconnect')}        ${pc.dim('Reconnect all enabled servers')}`);
        console.log(`  ${pc.cyan('/mcp enable <name>')}    ${pc.dim('Enable a disabled server')}`);
        console.log(`  ${pc.cyan('/mcp disable <name>')}   ${pc.dim('Disable a server without removing it')}`);
        console.log(`\n  ${pc.bold('Popular npm MCP servers (add to ~/.daedalus/config.json):')}`);
        console.log(`  ${pc.dim('  "server-name": { "transport": "stdio", "command": "npx", "args": ["-y", "@npm/package"], "enabled": true }')}`);
        console.log(`  ${pc.gray('→')} ${pc.cyan('filesystem')}       ${pc.dim('npx -y @modelcontextprotocol/server-filesystem <allowed-dir>')}`);
        console.log(`  ${pc.gray('→')} ${pc.cyan('puppeteer')}        ${pc.dim('npx -y @modelcontextprotocol/server-puppeteer')}`);
        console.log(`  ${pc.gray('→')} ${pc.cyan('memory')}           ${pc.dim('npx -y @modelcontextprotocol/server-memory')}`);
        console.log(`  ${pc.gray('→')} ${pc.cyan('fetch')}            ${pc.dim('npx -y @modelcontextprotocol/server-fetch')}`);
        console.log(`  ${pc.gray('→')} ${pc.cyan('sequential-thinking')} ${pc.dim('npx -y @modelcontextprotocol/server-sequential-thinking')}`);
        console.log(`  ${pc.gray('→')} ${pc.cyan('github')}           ${pc.dim('npx -y @github/github-mcp-server')}`);
        console.log(`  ${pc.gray('→')} ${pc.cyan('sqlite')}           ${pc.dim('npx -y @modelcontextprotocol/server-sqlite <db-path>')}`);
        console.log(`  ${pc.dim('  Then run /mcp reconnect to load them.')}`);
        console.log();
    }
  }
};
