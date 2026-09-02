import type { ToolDefinition, ChatMessage } from '../types.js';

export interface ContextSelectorOptions {
  userPrompt?: string;
  activeFiles?: string[];
  recentMessages?: ChatMessage[];
  recentToolCalls?: string[];
  agentRole?: string;
  enabled?: boolean;
}

export const CORE_ESSENTIAL_TOOLS = new Set<string>([
  'read_file',
  'write_file',
  'patch',
  'search_files',
  'list_files',
  'terminal',
  'git_status',
  'git_diff',
  'todo',
  'ask_user',
]);

const LSP_EXTENSIONS = new Set<string>([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.cs', '.php', '.rb',
]);

const LSP_PROMPT_RE = /\b(type|types|typecheck|compiler|diagnostics?|lsp|compile|syntax|rename|eval|hover|symbol|interfaces?|ts\d{4})\b/i;
const LSP_ERROR_RE = /TS\d{4}|SyntaxError|TypeError|ReferenceError|compile error|build failed|tsc\b/i;

const GRAPH_PROMPT_RE = /\b(symbol|symbols|definition|defined|references?|referenced|callee|caller|call graph|calls|impact|who calls|where is|trace|refactor|architecture|codebase index|reindex)\b/i;

const WEB_PROMPT_RE = /https?:\/\/|\b(web|search|browse|fetch|url|docs|documentation|online|scrape|lookup|website|internet)\b/i;

const PROCESS_PROMPT_RE = /\b(process|daemon|server|background|port|pid|kill|listening|watch process|system info|memory|cpu|specs)\b/i;

const ORCHESTRATION_PROMPT_RE = /\b(delegate|subagent|handoff|orchestrat|route|variable|context var)\b/i;

const SKILLS_PROMPT_RE = /\b(skill|skills|playbook|draft skill|scan ai|repos|recipes?)\b/i;

const IMAGE_PROMPT_RE = /\b(image|picture|drawing|photo|illustration|logo|icon|generate image|draw)\b/i;

export function selectContextTools(
  tools: ToolDefinition[],
  options: ContextSelectorOptions = {}
): ToolDefinition[] {
  if (options.enabled === false) {
    return tools;
  }

  const prompt = options.userPrompt ?? '';
  const activeFiles = options.activeFiles ?? [];
  const recentMessages = options.recentMessages ?? [];
  const recentToolCalls = new Set<string>(options.recentToolCalls ?? []);
  const role = (options.agentRole ?? '').toLowerCase();

  const recentText = recentMessages
    .slice(-4)
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');

  const hasLspFiles = activeFiles.some(f => {
    const ext = f.slice(f.lastIndexOf('.')).toLowerCase();
    return LSP_EXTENSIONS.has(ext);
  });

  const shouldIncludeLsp =
    hasLspFiles ||
    LSP_PROMPT_RE.test(prompt) ||
    LSP_ERROR_RE.test(recentText) ||
    recentToolCalls.has('lsp_diagnostics') ||
    recentToolCalls.has('lsp_hover') ||
    recentToolCalls.has('lsp_rename') ||
    recentToolCalls.has('eval_code');

  const shouldIncludeGraph =
    GRAPH_PROMPT_RE.test(prompt) ||
    recentToolCalls.has('find_symbol') ||
    recentToolCalls.has('get_definition') ||
    recentToolCalls.has('get_references') ||
    recentToolCalls.has('get_call_graph') ||
    recentToolCalls.has('get_impact') ||
    recentToolCalls.has('index_codebase');

  const shouldIncludeWeb =
    WEB_PROMPT_RE.test(prompt) ||
    recentToolCalls.has('web_search') ||
    recentToolCalls.has('fetch_url') ||
    recentToolCalls.has('screenshot_page');

  const shouldIncludeProcesses =
    PROCESS_PROMPT_RE.test(prompt) ||
    recentToolCalls.has('watch_process') ||
    recentToolCalls.has('read_process') ||
    recentToolCalls.has('kill_process') ||
    recentToolCalls.has('system_info');

  const shouldIncludeOrchestration =
    role === 'orchestrator' ||
    role === 'daedalus' ||
    ORCHESTRATION_PROMPT_RE.test(prompt) ||
    recentToolCalls.has('delegate_task') ||
    recentToolCalls.has('handoff_task') ||
    recentToolCalls.has('route_task');

  const shouldIncludeSkills =
    SKILLS_PROMPT_RE.test(prompt) ||
    recentToolCalls.has('propose_skill') ||
    recentToolCalls.has('scan_ai_repos');

  const shouldIncludeImage =
    IMAGE_PROMPT_RE.test(prompt) ||
    recentToolCalls.has('generate_image');

  const priorityWeights = new Map<string, number>();

  for (const tool of tools) {
    const name = tool.function.name;
    let weight = 0;

    if (CORE_ESSENTIAL_TOOLS.has(name)) {
      weight = 50;
    }

    if (name.startsWith('lsp_') || name === 'eval_code') {
      if (shouldIncludeLsp) {
        weight = LSP_ERROR_RE.test(recentText) ? 90 : 70;
      }
    } else if (
      name === 'find_symbol' ||
      name === 'get_definition' ||
      name === 'get_references' ||
      name === 'get_call_graph' ||
      name === 'get_impact' ||
      name === 'index_codebase'
    ) {
      if (shouldIncludeGraph) {
        weight = 75;
      }
    } else if (name === 'web_search' || name === 'fetch_url' || name === 'screenshot_page') {
      if (shouldIncludeWeb) {
        weight = 80;
      }
    } else if (
      name === 'watch_process' ||
      name === 'read_process' ||
      name === 'kill_process' ||
      name === 'system_info'
    ) {
      if (shouldIncludeProcesses) {
        weight = 65;
      }
    } else if (
      name === 'delegate_task' ||
      name === 'handoff_task' ||
      name === 'route_task' ||
      name === 'set_context_variable' ||
      name === 'get_context_variable'
    ) {
      if (shouldIncludeOrchestration) {
        weight = 60;
      }
    } else if (name === 'propose_skill' || name === 'scan_ai_repos') {
      if (shouldIncludeSkills) {
        weight = 55;
      }
    } else if (name === 'generate_image') {
      if (shouldIncludeImage) {
        weight = 85;
      }
    } else {
      weight = 40;
    }

    if (recentToolCalls.has(name)) {
      weight += 20;
    }

    priorityWeights.set(name, weight);
  }

  const selected = tools.filter(t => (priorityWeights.get(t.function.name) ?? 0) > 0);

  selected.sort((a, b) => (priorityWeights.get(b.function.name) ?? 0) - (priorityWeights.get(a.function.name) ?? 0));

  return selected;
}
