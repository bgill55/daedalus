import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { commandsList } from '../src/commands.js';
import { ConfigSchema } from '../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

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
};

const COMMAND_GROUPS: { name: string; commands: string[] }[] = [
  {
    name: 'Multi-Agent & Orchestration',
    commands: ['/orchestrate', '/autopilot', '/spawn', '/task', '/tasks', '/ensemble', '/debug', '/spec']
  },
  {
    name: 'Codebase Search & Live Watcher',
    commands: ['/watch', '/index', '/find', '/refs', '/def', '/callgraph', '/impact']
  },
  {
    name: 'Developer Tools, Git & MCP',
    commands: ['/test', '/commit', '/branch', '/pr', '/mcp', '/image', '/undo', '/ci', '/badge']
  },
  {
    name: 'Memory, Conventions & Config',
    commands: ['/project', '/config', '/profile', '/style', '/fact', '/convention', '/memory', '/extract', '/session', '/prune']
  },
  {
    name: 'Context & CLI Utilities',
    commands: ['/add', '/remove', '/context', '/paste', '/tokens', '/clear', '/summarize', '/system', '/health', '/models', '/doctor', '/changelog', '/help', '/update', '/exit', '/preview']
  }
];

function syncCommandsTable() {
  const readmePath = path.join(projectRoot, 'README.md');
  let readmeContent = fs.readFileSync(readmePath, 'utf8');

  const startMarker = '<!-- START_COMMANDS_TABLE -->';
  const endMarker = '<!-- END_COMMANDS_TABLE -->';

  const startIndex = readmeContent.indexOf(startMarker);
  const endIndex = readmeContent.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find command table placeholders in README.md');
    process.exit(1);
  }

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

  // Fallback for any commands not in explicit categories
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

  const updatedContent = `${before}\n${content}\n${after}`;
  fs.writeFileSync(readmePath, updatedContent, 'utf8');
  console.log('Successfully synchronized categorized commands table in README.md');
}

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
  { prefix: 'updateCheck', title: 'Update Settings' },
];

function syncConfigReference() {
  const docPath = path.join(projectRoot, 'docs', 'configuration-reference.md');
  const existingDescriptions: Record<string, string> = {
    'version': 'Config file schema version. Do not edit manually. Default: 1.',
    'modelOverride': 'Pin a specific model for the current session, bypassing routing, complexity classification, and auto-escalation. Set via /config, /model, or a project .daedalusrc override.',
    'router.strategy': 'Routing strategy: "priority" (try models in order), "round-robin" (cycle evenly), or "fastest" (lowest latency). Default: "priority".',
    'router.chain': 'Ordered list of model endpoint configurations. Each entry defines name, endpoint URL, model, priority, tier, and capability flags.',
    'router.healthCheckInterval': 'Interval in milliseconds between background health checks on configured endpoints. Default: 30000.',
    'router.requestTimeout': 'Maximum wait in milliseconds for a model response before considering it failed. Default: 120000.',
    'router.slowModelThresholdMs': 'Average latency in milliseconds above which a model is blacklisted for the rest of the session. Set to 0 to disable. Default: 45000.',
    'router.defaultRateLimit': 'Default rate limit settings (rpm and tpm) applied when an endpoint does not advertise its own limits.',
    'router.autoEscalate': 'When true, automatically switches to the next chain model after repeated tool failures. Default: true.',
    'router.complexityRouting': 'When true, routes each task by complexity tier: simple tasks use the fast tier, complex tasks use the intelligence tier, with on-the-fly reclassification mid-task. Default: true.',
    'agents.default': 'Default agent role used when no specific role is requested. Default: "coder".',
    'agents.available': 'List of available agent roles for orchestration (orchestrator, planner, coder, reviewer, debugger, researcher).',
    'agents.autoOrchestrate': 'When true, automatically invoke the orchestrator for complex multi-step tasks instead of single-agent mode. Default: true.',
    'agents.ensemble': 'Ensemble drafting pipeline config: enables multi-model collaboration with draft and critic models for improved output quality.',
    'tools.builtin': 'List of built-in tool identifiers available to agents (read_file, write_file, patch, terminal, web_search, etc.).',
    'tools.mcpServers': 'Map of MCP server configurations. Each entry defines transport (stdio/http), command, args, URL, headers, and enabled flag.',
    'tools.shell': 'Preferred shell executable for terminal commands (e.g. "powershell", "bash", "/bin/zsh"). Falls back to SHELL env or OS default.',
    'tools.sandbox': 'Execution sandbox mode: "none" (host direct), "docker", or "wsl" (Windows). Default: "none".',
    'tools.sandboxImage': 'Docker image used when sandbox is set to "docker". Default: "node:20".',
    'tools.wslDistribution': 'WSL distribution name used when sandbox is set to "wsl" (e.g. "Ubuntu", "Debian").',
    'imageGen.enabled': 'Enable/disable local image generation tool and commands. Default: true.',
    'imageGen.provider': 'Image generation engine: "auto" (try SD WebUI first, fall back to Pollinations), "sd-webui", or "pollinations". Default: "auto".',
    'imageGen.endpoint': 'Local Stable Diffusion WebUI API endpoint URL. Default: "http://127.0.0.1:7860".',
    'imageGen.defaultWidth': 'Default image width in pixels. Default: 512.',
    'imageGen.defaultHeight': 'Default image height in pixels. Default: 512.',
    'imageGen.defaultSteps': 'Default sampling steps for image generation. Default: 20.',
    'imageGen.outputDir': 'Directory path for saving generated PNG images. Default: "./assets/images".',
    'context.maxTokens': 'Maximum token budget for the active conversation context window. Default: 128000.',
    'context.summarizeAt': 'Threshold (0.0-1.0) of token budget usage that triggers automatic summarization. Default: 0.8.',
    'context.includeGitDiff': 'When true, automatically includes git diff output in the system prompt for context awareness. Default: true.',
    'context.includeIndex': 'When true, includes codebase index search results in the system prompt. Default: true.',
    'indexing.enabled': 'Enable/disable automatic FTS5 codebase indexing on startup. Default: true.',
    'indexing.watch': 'Enable/disable the background file watcher for real-time symbol re-indexing. Default: true.',
    'indexing.languages': 'List of file extensions/languages to index (e.g. typescript, python, go, rust).',
    'indexing.exclude': 'List of directory patterns to exclude from codebase indexing.',
    'session.autoSave': 'When true, automatically saves session state after each conversation turn. Default: true.',
    'session.exportJsonl': 'When true, exports session history as JSONL for external analysis. Default: true.',
    'session.maxHistoryTurns': 'Maximum number of conversation turns retained in session history. Default: 200.',
    'ui.streaming': 'When true, streams model responses token-by-token in real-time. Default: true.',
    'ui.showTokens': 'When true, displays estimated token counts alongside responses. Default: true.',
    'ui.showCost': 'When true, displays estimated cost per response for cloud models. Default: true.',
    'ui.diffStyle': 'Diff display style: "unified" or "side-by-side". Default: "unified".',
    'ui.theme': 'UI theme: "dark", "light", or "auto" (follow system). Default: "dark".',
    'ui.tui': 'When true, launches the terminal user interface (TUI) dashboard on start. Default: false.',
    'ui.compactMode': 'When true, compresses non-essential CLI output for a cleaner terminal display. Default: true.',
    'ui.collapseCommentary': 'When true, collapses verbose model commentary into a single line instead of printing full paragraphs. Default: true.',
    'safety.protectGit': 'When true, requires explicit user confirmation before running git operations. Default: true.',
    'safety.autoApprove': 'When true, automatically approves terminal command execution without user prompt. Default: false.',
    'updateCheck': 'When true, checks for new Daedalus CLI versions on startup and notifies you. Default: true.',
  };

  if (fs.existsSync(docPath)) {
    const content = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\*\s+\*\*`([\w.-]+)`\*\*:\s*(.*)$/);
      if (match && !/^\(Description needed\)$/.test(match[2].trim())) {
        existingDescriptions[match[1]] = match[2].trim();
      }
    }
  }

  const configPaths = extractSchemaPaths(ConfigSchema);
  const sectionBlocks: string[] = [];

  for (const section of SECTIONS) {
    const keysInSection = section.prefix === '__top__'
      ? configPaths.filter(key => !key.includes('.'))
      : configPaths.filter(key => key.startsWith(section.prefix));
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
}

syncCommandsTable();
syncConfigReference();
