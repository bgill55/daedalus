import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { commandsList } from './commands.js';
import { ConfigSchema } from './config/index.js';

function extractSchemaPaths(schema: any, prefix = ''): string[] {
  const paths: string[] = [];
  if (!schema) return paths;

  if (prefix.split('.').length >= 2) {
    return paths;
  }

  if (schema._def && schema._def.shape) {
    const shape = schema._def.shape();
    for (const key of Object.keys(shape)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      paths.push(currentPath);
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
      '/commit': '/commit [msg]',
      '/test': '/test [n]',
      '/branch': '/branch [name]',
      '/pr': '/pr [base]',
      '/project': '/project [set <key> = <val>]',
      '/config': '/config [set <key> = <val>]',
      '/prune': '/prune [budget]',
      '/fact': '/fact [text]',
      '/convention': '/convention [text]',
      '/session': '/session [name]',
    };

    let table = `| Command | Description |\n`;
    table += `|---------|-------------|\n`;

    for (const cmd of commandsList) {
      const usage = COMMAND_USAGES[cmd.name] || cmd.name;
      const allNames = [usage];
      if (cmd.aliases) {
        allNames.push(...cmd.aliases);
      }
      const commandCell = allNames.map(n => `\`${n}\``).join(' / ');
      table += `| ${commandCell} | ${cmd.description} |\n`;
    }

    const before = readmeContent.substring(0, startIndex + startMarker.length);
    const after = readmeContent.substring(endIndex);
    const expectedReadmeContent = `${before}\n${table}${after}`;

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
      if (match) {
        existingDescriptions[match[1]] = match[2].trim();
      }
    }

    const configPaths = extractSchemaPaths(ConfigSchema);
    const SECTIONS = [
      { prefix: 'router.', title: 'Router Settings' },
      { prefix: 'agents.', title: 'Agent Settings' },
      { prefix: 'tools.', title: 'Tool Settings' },
      { prefix: 'context.', title: 'Context Settings' },
      { prefix: 'indexing.', title: 'Codebase Indexing Settings' },
      { prefix: 'session.', title: 'Session Settings' },
      { prefix: 'ui.', title: 'UI Settings' },
      { prefix: 'safety.', title: 'Safety Settings' },
      { prefix: 'updateCheck', title: 'Update Settings' },
    ];

    const sectionBlocks: string[] = [];
    for (const section of SECTIONS) {
      const keysInSection = configPaths.filter(key => key.startsWith(section.prefix));
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
});
