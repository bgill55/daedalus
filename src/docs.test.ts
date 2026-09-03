import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { commandsList } from './commands.js';
import { ConfigSchema } from './config/index.js';

function extractSchemaPaths(schema: any, prefix = ''): string[] {
  const paths: string[] = [];
  if (!schema) return paths;

  if (prefix.split('.').length >= 2) {
    paths.push(prefix);
    return paths;
  }

  if (schema._def && schema._def.shape) {
    const shape = schema._def.shape();
    for (const key of Object.keys(shape)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      paths.push(...extractSchemaPaths(shape[key], currentPath));
    }
  } else if (schema._def && schema._def.schema) {
    paths.push(...extractSchemaPaths(schema._def.schema, prefix));
  } else if (schema._def && schema._def.valueType) {
    paths.push(...extractSchemaPaths(schema._def.valueType, prefix));
  } else if (schema._def && schema._def.type) {
    paths.push(...extractSchemaPaths(schema._def.type, prefix));
  } else if (schema._def && schema._def.innerType) {
    paths.push(...extractSchemaPaths(schema._def.innerType, prefix));
  } else {
    paths.push(prefix);
  }

  return paths;
}

describe('Documentation Sync Verification', () => {
  const projectRoot = process.cwd();
  const mdFiles = [
    path.join(projectRoot, 'README.md'),
    ...fs.readdirSync(path.join(projectRoot, 'docs'))
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(projectRoot, 'docs', f))
  ];

  const allMdContent = mdFiles
    .map(filePath => fs.readFileSync(filePath, 'utf8'))
    .join('\n');

  it('verifies all CLI commands are documented', () => {
    for (const cmd of commandsList) {
      const cmdName = cmd.name;
      expect(allMdContent).toContain(cmdName);
    }
  });

  it('verifies all config schema keys are documented', () => {
    const configPaths = extractSchemaPaths(ConfigSchema);
    for (const p of configPaths) {
      expect(allMdContent).toContain(p);
    }
  });

  it('verifies documentation is up-to-date with sync-docs generator', () => {
    const readmePath = path.join(projectRoot, 'README.md');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');

    const startMarker = '<!-- START_COMMANDS_TABLE -->';
    const endMarker = '<!-- END_COMMANDS_TABLE -->';

    const startIndex = readmeContent.indexOf(startMarker);
    const endIndex = readmeContent.indexOf(endMarker);

    expect(startIndex).not.toBe(-1);
    expect(endIndex).not.toBe(-1);

    const COMMAND_USAGES: Record<string, string> = {
      '/orchestrate': '/orchestrate <goal>',
      '/spawn': '/spawn [--bg] <role> <task>',
      '/task': '/task <id>',
      '/ensemble': '/ensemble <goal>',
      '/debug': '/debug <command>',
      '/find': '/find <query>',
      '/refs': '/refs <symbol>',
      '/def': '/def <symbol>',
      '/callgraph': '/callgraph <symbol> [depth]',
      '/impact': '/impact <symbol>',
      '/commit': '/commit [msg]',
      '/test': '/test [n] [-g]',
      '/watch': '/watch [start|stop|status]',
      '/mcp': '/mcp <explore|search|install|list|rm>',
      '/branch': '/branch [name]',
      '/pr': '/pr [base]',
      '/project': '/project [set <key> = <val>]',
      '/config': '/config [set <key> = <val>]',
      '/prune': '/prune [budget]',
      '/fact': '/fact [text]',
      '/convention': '/convention [text]',
      '/autopilot': '/autopilot <feature>',
      '/session': '/session [name]',
      '/preview': '/preview <filepath-or-url>',
      '/ci': '/ci [review|fix]',
      '/badge': '/badge [custom <label> <message> [color]] [--write]',
      '/spinner': '/spinner [list | braille | tracker | aurora]',
      '/scan-ai-repos': '/scan-ai-repos [--top N] [--query "topic:..."] [--issue] [--repo owner/name]',
      '/marathon': '/marathon <goal> | status | resume | pr | rollback | abort',
      '/webui': '/webui [start|stop|open|status|rate <ms>]',
      '/hunt': '/hunt <bug description>',
    };

    const COMMAND_GROUPS: { name: string; commands: string[] }[] = [
      {
        name: 'Multi-Agent, Orchestration & Autonomous Marathon',
        commands: ['/orchestrate', '/marathon', '/autopilot', '/hunt', '/spawn', '/task', '/tasks', '/ensemble', '/debug', '/spec']
      },
      {
        name: 'Codebase Search & Live Watcher',
        commands: ['/watch', '/index', '/find', '/refs', '/def', '/callgraph', '/impact']
      },
      {
        name: 'Developer Tools, Git, MCP & Web UI',
        commands: ['/webui', '/test', '/commit', '/branch', '/pr', '/mcp', '/image', '/undo', '/ci', '/badge', '/scan-ai-repos']
      },
      {
        name: 'Memory, Conventions & Config',
        commands: ['/project', '/config', '/profile', '/style', '/fact', '/convention', '/memory', '/extract', '/session', '/prune']
      },
      {
        name: 'Context & CLI Utilities',
        commands: ['/add', '/remove', '/context', '/paste', '/tokens', '/clear', '/summarize', '/system', '/health', '/models', '/doctor', '/changelog', '/help', '/update', '/exit', '/preview', '/spinner']
      }
    ];

    const processedNames = new Set<string>();
    let content = '';

    for (const group of COMMAND_GROUPS) {
      content += `\n### ${group.name}\n\n`;
      content += `| Command | Description |\n`;
      content += `|---------|-------------|\n`;

      for (const cmdName of group.commands) {
        const cmd = commandsList.find(c => c.name === cmdName);
        if (!cmd) continue;

        processedNames.add(cmd.name);
        const usage = COMMAND_USAGES[cmd.name] || cmd.name;
        const allNames = [usage];
        if (cmd.aliases) {
          allNames.push(...cmd.aliases);
        }
        const commandCell = allNames.map(n => `\`${n.replace(/\|/g, '\\|')}\``).join(' / ');
        const descCell = cmd.description.replace(/\|/g, '\\|');
        content += `| ${commandCell} | ${descCell} |\n`;
      }
    }

    const unmapped = commandsList.filter(c => !processedNames.has(c.name));
    if (unmapped.length > 0) {
      content += `\n### Additional Commands\n\n`;
      content += `| Command | Description |\n`;
      content += `|---------|-------------|\n`;
      for (const cmd of unmapped) {
        const usage = COMMAND_USAGES[cmd.name] || cmd.name;
        const allNames = [usage];
        if (cmd.aliases) {
          allNames.push(...cmd.aliases);
        }
        const commandCell = allNames.map(n => `\`${n.replace(/\|/g, '\\|')}\``).join(' / ');
        const descCell = cmd.description.replace(/\|/g, '\\|');
        content += `| ${commandCell} | ${descCell} |\n`;
      }
    }

    const before = readmeContent.substring(0, startIndex + startMarker.length);
    const after = readmeContent.substring(endIndex);
    const expectedReadmeContent = `${before}\n${content}\n${after}`;

    if (readmeContent.replace(/\r\n/g, '\n') !== expectedReadmeContent.replace(/\r\n/g, '\n')) {
      const a = readmeContent.replace(/\r\n/g, '\n');
      const b = expectedReadmeContent.replace(/\r\n/g, '\n');
      let diffMsg = `README.md commands table is out of sync.\nACTUAL LENGTH: ${a.length}, EXPECTED LENGTH: ${b.length}\n`;
      const aLines = a.split('\n');
      const bLines = b.split('\n');
      for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
        if (aLines[i] !== bLines[i]) {
          diffMsg += `Diff at README.md line ${i + 1}:\nACTUAL:   |${aLines[i]}|\nEXPECTED: |${bLines[i]}|\n`;
        }
      }
      throw new Error(diffMsg + "\nPlease run 'npm run sync-docs' to automatically update it.");
    }

    const docPath = path.join(projectRoot, 'docs', 'configuration-reference.md');
    const existingDescriptions: Record<string, string> = {};

    expect(fs.existsSync(docPath)).toBe(true);
    
    const docContent = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
    const lines = docContent.split('\n');
    for (const line of lines) {
      const match = line.match(/^\*\s+\*\*`([\w.-]+)`\*\*:\s*(.*)$/);
      if (match && !/^\(Description needed\)$/.test(match[2].trim())) {
        existingDescriptions[match[1]] = match[2].trim();
      }
    }

    const configPaths = extractSchemaPaths(ConfigSchema);
    const SECTIONS = [
      { prefix: '__top__', title: 'General Settings' },
      { prefix: 'router.', title: 'Router Settings' },
      { prefix: 'agents.', title: 'Agent Settings' },
      { prefix: 'tools.', title: 'Tool Settings' },
      { prefix: 'imageGen.', title: 'Image Generation Settings' },
      { prefix: 'context.', title: 'Context Settings' },
      { prefix: 'indexing.', title: 'Codebase Indexing Settings' },
      { prefix: 'session.', title: 'Session Settings' },
      { prefix: 'ui.', title: 'UI Settings' },
      { prefix: 'safety.', title: 'Safety Settings' },
      { prefix: 'security.', title: 'Security Settings' },
      { prefix: 'git.', title: 'Git Settings' },
      { prefix: 'updateCheck', title: 'Update Settings' },
    ];

    const sectionBlocks: string[] = [];
    for (const section of SECTIONS) {
      const keysInSection = section.prefix === '__top__'
        ? configPaths.filter(key => !key.includes('.') && key !== 'updateCheck')
        : configPaths.filter(key => key.startsWith(section.prefix));
      if (keysInSection.length === 0) continue;

      let block = `## ${section.title}\n\n`;
      for (const key of keysInSection) {
        const desc = existingDescriptions[key] || '(Description needed)';
        block += `*   **\`${key}\`**: ${desc}\n`;
      }
      sectionBlocks.push(block.trim());
    }

    let expectedDocContent = `# Configuration Reference Guide\n\n`;
    expectedDocContent += `This guide describes all configuration options available in Daedalus. You can view them using the \`/config\` command and update them using the \`/config set <key> = <value>\` command. All settings updated via the command line are validated and applied instantly in real-time without requiring a CLI restart.\n\n`;
    expectedDocContent += `---\n\n`;
    expectedDocContent += sectionBlocks.join('\n\n---\n\n') + '\n';

    if (docContent.replace(/\r\n/g, '\n') !== expectedDocContent.replace(/\r\n/g, '\n')) {
      const a = docContent.replace(/\r\n/g, '\n');
      const b = expectedDocContent.replace(/\r\n/g, '\n');
      let diffMsg = `docs/configuration-reference.md is out of sync.\nACTUAL LENGTH: ${a.length}, EXPECTED LENGTH: ${b.length}\n`;
      const aLines = a.split('\n');
      const bLines = b.split('\n');
      for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
        if (aLines[i] !== bLines[i]) {
          diffMsg += `Diff at docs/configuration-reference.md line ${i + 1}:\nACTUAL:   |${aLines[i]}|\nEXPECTED: |${bLines[i]}|\n`;
        }
      }
      throw new Error(diffMsg + "\nPlease run 'npm run sync-docs' to automatically update it.");
    }
  });

  it('verifies the API-media config reference matches the canonical one', () => {
    const canonicalPath = path.join(projectRoot, 'docs', 'configuration-reference.md');
    const mediaPath = path.join(projectRoot, 'docs', 'api', 'media', 'configuration-reference.md');
    expect(fs.existsSync(canonicalPath)).toBe(true);
    expect(fs.existsSync(mediaPath)).toBe(true);
    const canonical = fs.readFileSync(canonicalPath, 'utf8').replace(/\r\n/g, '\n');
    const media = fs.readFileSync(mediaPath, 'utf8').replace(/\r\n/g, '\n');
    expect(media).toBe(canonical);
  });
});
