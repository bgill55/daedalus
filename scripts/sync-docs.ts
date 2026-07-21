import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { commandsList } from '../src/commands.js';
import { ConfigSchema } from '../src/config/index.js'; const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..'); function extractSchemaPaths(schema: any, prefix = ''): string[] { const paths: string[] = []; if (!schema) return paths; if (prefix.split('.').length >= 2) { return paths; } if (schema._def && schema._def.shape) { const shape = schema._def.shape(); for (const key of Object.keys(shape)) { const currentPath = prefix ? `${prefix}.${key}` : key; paths.push(currentPath); paths.push(...extractSchemaPaths(shape[key], currentPath)); } } else if (schema._def && schema._def.schema) { paths.push(...extractSchemaPaths(schema._def.schema, prefix)); } else if (schema._def && schema._def.valueType) { paths.push(...extractSchemaPaths(schema._def.valueType, prefix)); } else if (schema._def && schema._def.type) { paths.push(...extractSchemaPaths(schema._def.type, prefix)); } else if (schema._def && schema._def.innerType) { paths.push(...extractSchemaPaths(schema._def.innerType, prefix)); } return paths;
} const COMMAND_USAGES: Record<string, string> = { '/orchestrate': '/orchestrate <goal>', '/spawn': '/spawn [--bg] <role> <task>', '/task': '/task <id>', '/ensemble': '/ensemble <goal>', '/debug': '/debug <command>', '/find': '/find <query>', '/refs': '/refs <symbol>', '/def': '/def <symbol>', '/commit': '/commit [msg]', '/test': '/test [n]', '/branch': '/branch [name]', '/pr': '/pr [base]', '/project': '/project [set <key> = <val>]', '/config': '/config [set <key> = <val>]', '/prune': '/prune [budget]', '/fact': '/fact [text]', '/convention': '/convention [text]', '/session': '/session [name]',
}; function syncCommandsTable() { const readmePath = path.join(projectRoot, 'README.md'); let readmeContent = fs.readFileSync(readmePath, 'utf8'); const startMarker = '<!-- START_COMMANDS_TABLE -->'; const endMarker = '<!-- END_COMMANDS_TABLE -->'; const startIndex = readmeContent.indexOf(startMarker); const endIndex = readmeContent.indexOf(endMarker); if (startIndex === -1 || endIndex === -1) { console.error('Could not find command table placeholders in README.md'); process.exit(1); } let table = `| Command | Description |\n`; table += `|---------|-------------|\n`; for (const cmd of commandsList) { const usage = COMMAND_USAGES[cmd.name] || cmd.name; const allNames = [usage]; if (cmd.aliases) { allNames.push(...cmd.aliases); } const commandCell = allNames.map(n => `\`${n}\``).join(' / '); table += `| ${commandCell} | ${cmd.description} |\n`; } const before = readmeContent.substring(0, startIndex + startMarker.length); const after = readmeContent.substring(endIndex); const updatedContent = `${before}\n${table}${after}`; fs.writeFileSync(readmePath, updatedContent, 'utf8'); console.log('Successfully synchronized commands table in README.md');
} const SECTIONS = [
  { prefix: 'router.', title: 'Router Settings' },
  { prefix: 'agents.', title: 'Agent Settings' },
  { prefix: 'tools.', title: 'Tool Settings' },
  { prefix: 'imageGen.', title: 'Image Generation Settings' },
  { prefix: 'context.', title: 'Context Settings' },
  { prefix: 'indexing.', title: 'Codebase Indexing Settings' },
  { prefix: 'session.', title: 'Session Settings' },
  { prefix: 'ui.', title: 'UI Settings' },
  { prefix: 'safety.', title: 'Safety Settings' },
  { prefix: 'updateCheck', title: 'Update Settings' },
];

function syncConfigReference() {
  const docPath = path.join(projectRoot, 'docs', 'configuration-reference.md');
  const existingDescriptions: Record<string, string> = {
    'imageGen.enabled': 'Enable/disable local image generation tool and commands (default: true).',
    'imageGen.endpoint': 'Local Stable Diffusion WebUI API endpoint URL (default: "http://127.0.0.1:7860").',
    'imageGen.defaultWidth': 'Default image width in pixels (default: 512).',
    'imageGen.defaultHeight': 'Default image height in pixels (default: 512).',
    'imageGen.defaultSteps': 'Default sampling steps for image generation (default: 20).',
    'imageGen.outputDir': 'Default directory to save generated PNG images (default: "./assets/images").',
  };
  if (fs.existsSync(docPath)) {
    const content = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\*\s+\*\*`([\w.-]+)`\*\*:\s*(.*)$/);
      if (match) {
        existingDescriptions[match[1]] = match[2].trim();
      }
    }
  }
  const configPaths = extractSchemaPaths(ConfigSchema);
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
  let mdContent = `# Configuration Reference Guide\n\n`;
  mdContent += `This guide describes all configuration options available in Daedalus. You can view them using the \`/config\` command and update them using the \`/config set <key> = <value>\` command. All settings updated via the command line are validated and applied instantly in real-time without requiring a CLI restart.\n\n`;
  mdContent += `---\n\n`;
  mdContent += sectionBlocks.join('\n\n---\n\n') + '\n';
  fs.writeFileSync(docPath, mdContent, 'utf8');
  console.log('Successfully synchronized docs/configuration-reference.md');
} syncCommandsTable();
syncConfigReference();
