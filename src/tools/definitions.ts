// Built-in tool definitions for OpenAI function calling
// These match the tool implementations in tools/builtin/

import type { ToolDefinition } from '../types.js';
import { getResolvedShellType } from './builtin/terminal.js';

export type { ToolDefinition };

// Surface the ACTUAL shell the terminal tool executes in, directly on the tool
// description. The orchestrator also injects a [SHELL] context note, but REPL /
// single-agent turns don't receive that context — so the model emits PowerShell/
// cmd syntax (del, Remove-Item, $null) into the bash shell on Windows hosts,
// which the shell rejects. Stating the resolved shell on the tool itself makes
// the fact available to EVERY agent regardless of which code path builds the
// system prompt.
function shellSyntaxHint(): string {
  const shell = getResolvedShellType();
  if (shell === 'bash') {
    return 'bash (git-bash/MSYS) on this Windows host — NOT PowerShell/cmd. Use "$", avoid "$null"/Select-String/"{}" blocks.';
  }
  if (shell === 'powershell') {
    return 'PowerShell — "$", "$null", Select-String are valid; avoid bash-only "2>/dev/null".';
  }
  return 'cmd.exe — use "dir", "2>nul", "if exist"; not bash, not PowerShell.';
}

export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file (text, PDF, or images like PNG, JPG, WebP). Reading an image file will automatically encode it and inject it into your chat context as a visual image for vision analysis.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path. Use FORWARD slashes (e.g. "D:/project/src/file.ts" or "./src/file.ts") — backslashes get mangled by JSON encoding on Windows.' },
          offset: { type: 'integer', description: 'Starting line number (1-indexed)', minimum: 1, default: 1 },
          limit: { type: 'integer', description: 'Maximum lines to read', minimum: 1, maximum: 2000, default: 1000 },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or completely overwrite a file. Creates parent directories automatically. With great power comes great responsibility.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path. Use FORWARD slashes (e.g. "D:/project/src/file.ts" or "./src/file.ts") — backslashes get mangled by JSON encoding on Windows.' },
          content: { type: 'string', description: 'Complete file content to write' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch',
      description: 'Apply a targeted edit by replacing old_string with new_string. Like find-and-replace, but it judges you if you get it wrong.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          old_string: { type: 'string', description: 'Exact text to find and replace (include context for uniqueness)' },
          new_string: { type: 'string', description: 'Replacement text (empty string to delete)' },
          replace_all: { type: 'boolean', description: 'Replace all occurrences', default: false },
        },
        required: ['path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file contents (ripgrep) or find files by name. Regex-supported. Use your words — I\'ll find it.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern for content search, or glob for file search' },
          target: { type: 'string', enum: ['content', 'files'], description: 'Search inside files or find files by name', default: 'content' },
          path: { type: 'string', description: 'Directory to search in', default: '.' },
          file_glob: { type: 'string', description: 'Filter files by glob pattern (e.g. "*.ts")' },
          limit: { type: 'integer', description: 'Max results', minimum: 1, maximum: 200, default: 50 },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List directory tree with optional depth, glob filter, and max result limit.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path', default: '.' },
          depth: { type: 'integer', description: 'Max recursion depth', minimum: 1, maximum: 10, default: 3 },
          glob: { type: 'string', description: 'Glob pattern to filter (e.g. "**/*.ts")' },
          limit: { type: 'integer', description: 'Max files to return', minimum: 1, maximum: 2000, default: 500 },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'terminal',
      description: 'Execute a shell command. Use for builds, tests, git, package managers, questionable life choices. Syntax MUST match the [SHELL] note: ' + shellSyntaxHint(),
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute. Syntax: ' + shellSyntaxHint() },
          timeout: { type: 'integer', description: 'Max seconds to wait', minimum: 1, maximum: 600, default: 180 },
          workdir: { type: 'string', description: 'Working directory (absolute path)' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show git diff of working tree or staged changes.',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Show staged changes instead of working tree', default: false },
          path: { type: 'string', description: 'Limit to specific file/directory' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Show git repository status (staged, unstaged, untracked files).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo',
      description: 'Manage task list for the current session. Use for planning and tracking.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Task items to write',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique item identifier' },
                content: { type: 'string', description: 'Task description' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'Current status' },
              },
              required: ['id', 'content', 'status'],
            },
          },
          merge: { type: 'boolean', description: 'Update existing items by id, add new ones', default: false },
        },
        required: ['todos'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for information. I\'ll read it so you don\'t have to.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'integer', description: 'Max results', minimum: 1, maximum: 20, default: 10 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch content from a URL. Please don\'t make me fetch anything from localhost — I have standards.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          timeout: { type: 'integer', description: 'Timeout in seconds', minimum: 1, maximum: 60, default: 30 },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate_task',
      description: 'Spawn a sub-agent to work on a subtask. It\'s like hiring a contractor without the paperwork.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'What the sub-agent should accomplish' },
          context: { type: 'string', description: 'Background information the sub-agent needs' },
          role: { type: 'string', description: 'Agent role: coder, reviewer, debugger, researcher, planner', enum: ['coder', 'reviewer', 'debugger', 'researcher', 'planner'] },
          toolsets: { type: 'array', items: { type: 'string' }, description: 'Toolsets to enable for this sub-agent' },
        },
        required: ['goal'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'index_codebase',
      description: 'Analyze and index codebase symbols and references.',
      parameters: {
        type: 'object',
        properties: {
          exclude: { type: 'array', items: { type: 'string' }, description: 'Directories to exclude' },
          extensions: { type: 'array', items: { type: 'string' }, description: 'File extensions to index' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_symbol',
      description: 'Fuzzy search code symbols (classes, functions, etc.) in the codebase using FTS5.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Fuzzy search query term' },
          limit: { type: 'integer', description: 'Max search results', minimum: 1, maximum: 100, default: 30 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_definition',
      description: 'Retrieve the file path, line range, and signature for a symbol declaration by exact name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact symbol name' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_references',
      description: 'Retrieve all caller locations referencing a symbol name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Symbol name to find calls to' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_call_graph',
      description: 'Retrieve bidirectional function call graph (inbound callers and outbound calls) and blast-radius impact analysis.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Function or symbol name' },
          depth: { type: 'integer', description: 'Traversal depth (default: 2)', default: 2 },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Ask the user a question or present a list of choices, and wait for their input. Use this to clarify requirements or get user feedback before making critical decisions.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of multiple choice options for the user to select from',
          },
        },
        required: ['question'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_skill',
      description:
        'Capture a reusable playbook for a problem you SUCCESSFULLY solved that is likely to recur. NEVER invoke propose_skill when a task or patch has failed, when stuck in an error loop, or for single one-off feature edits. Only use after cleanly resolving a non-obvious, repeatable workflow.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short kebab-case skill name, e.g. fix-typescript-build' },
          description: { type: 'string', description: 'One-line summary of what the skill does' },
          trigger: { type: 'string', description: 'Pipe-separated keywords that should activate this skill, e.g. typescript|build|tsc' },
          body: { type: 'string', description: 'The playbook body: instructions the agent follows with its tools' },
        },
        required: ['name', 'body'],
        additionalProperties: false,
      },
    },
  },
];

export const POWER_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'lsp_diagnostics',
      description: 'Get TypeScript type errors and diagnostics for a file or the whole project using the real language service. Know before you guess.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to check (omit for whole project)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_hover',
      description: 'Get the inferred TypeScript type and JSDoc at a specific file position. Answer "what type is this?" without guessing.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          line: { type: 'integer', description: 'Line number (1-indexed)' },
          col: { type: 'integer', description: 'Column number (1-indexed)' },
        },
        required: ['path', 'line', 'col'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_rename',
      description: 'Atomically rename a symbol across all files using the TypeScript language service. Safe cross-file refactor.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File containing the symbol to rename' },
          line: { type: 'integer', description: 'Line number of the symbol (1-indexed)' },
          col: { type: 'integer', description: 'Column number of the symbol (1-indexed)' },
          new_name: { type: 'string', description: 'New symbol name' },
        },
        required: ['path', 'line', 'col', 'new_name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot_page',
      description: 'Take a screenshot of a URL (e.g. http://localhost:3000) and see what the UI actually looks like. Requires Chrome.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to screenshot (e.g. http://localhost:3000)' },
          selector: { type: 'string', description: 'Optional CSS selector to screenshot a specific element' },
          width: { type: 'integer', description: 'Viewport width in pixels', default: 1280 },
          height: { type: 'integer', description: 'Viewport height in pixels', default: 900 },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_impact',
      description: 'Analyze the blast radius of changing a file — returns all files that directly or transitively import it. Check before you wreck.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'File path to analyze (relative or absolute)' },
        },
        required: ['target'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'watch_process',
      description: 'Start a background process (e.g. npm run dev) and capture its output into a ring buffer. Use read_process to poll it.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run in the background' },
          workdir: { type: 'string', description: 'Working directory (defaults to project root)' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_process',
      description: 'Read the last N lines of output from a watched background process.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Process ID returned by watch_process' },
          lines: { type: 'integer', description: 'Number of lines to return', default: 50, minimum: 1, maximum: 200 },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kill_process',
      description: 'Terminate a background process started with watch_process.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Process ID to terminate' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eval_code',
      description: 'Run a JS or TS snippet in the project module context and return the output. For validating logic, regex, or API shapes without writing a full file. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript or TypeScript code snippet to evaluate' },
          lang: { type: 'string', enum: ['js', 'ts'], description: 'Language: js or ts (default: ts)', default: 'ts' },
          timeout: { type: 'integer', description: 'Execution timeout in seconds', default: 10, minimum: 1, maximum: 60 },
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_info',
      description: 'Get the user\'s operating system, hardware, and shell environment. Use this when you need to know what OS, architecture, CPU count, memory, or shell the user is running on.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate an image using local Stable Diffusion WebUI or Pollinations AI and save it to disk.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed prompt describing the image to generate' },
          negative_prompt: { type: 'string', description: 'Negative prompt specifying elements to avoid in the generated image' },
          width: { type: 'integer', description: 'Image width in pixels (default: 512)', default: 512 },
          height: { type: 'integer', description: 'Image height in pixels (default: 512)', default: 512 },
          steps: { type: 'integer', description: 'Sampling steps for image generation (default: 20)', default: 20 },
          provider: { type: 'string', enum: ['auto', 'sd-webui', 'pollinations'], description: 'Image generation engine: auto (local SD with Pollinations fallback), sd-webui, or pollinations (default: auto)', default: 'auto' },
          output_path: { type: 'string', description: 'Relative or absolute file path to save the generated PNG image' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'handoff_task',
      description: 'Dynamically hand off the active execution turn to another specialized sub-agent role (planner, coder, reviewer, debugger, researcher) with notes and shared context updates.',
      parameters: {
        type: 'object',
        properties: {
          target_role: { type: 'string', enum: ['planner', 'coder', 'reviewer', 'debugger', 'researcher'], description: 'The target sub-agent role to transfer control to.' },
          handoff_notes: { type: 'string', description: 'Summary of work accomplished and specific instructions for the next agent role.' },
          context_updates: { type: 'object', description: 'Optional key-value pairs to store in shared contextVariables for subsequent agent turns.' },
        },
        required: ['target_role', 'handoff_notes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_context_variable',
      description: 'Set a key-value pair in the shared contextVariables state bag to persist structured metadata across agent turns and handoffs.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The state variable key name (e.g. target_files, test_status).' },
          value: { description: 'The value to store (string, number, boolean, array, or object).' },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_context_variable',
      description: 'Read a key from the shared contextVariables state bag. Returns its stored value (or a notice if the key is unset) so an agent can act on cross-turn / cross-handoff state.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The state variable key to read (e.g. target_files, test_status, pr_number).' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'route_task',
      description: 'Fan a large multi-phase task out to helper sub-agents (planner, coder, reviewer, debugger, researcher) that run in parallel and report back, so the user does not have to spawn agents manually. REQUIRES prior user approval: call ask_user first, then invoke this with confirmed: true. Each sub-task is an independent {role, goal} pair.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Independent sub-tasks to delegate in parallel. Each: { role: one of planner|coder|reviewer|debugger|researcher, goal: concrete instruction, context?: extra context }.',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['planner', 'coder', 'reviewer', 'debugger', 'researcher'] },
                goal: { type: 'string' },
                context: { type: 'string' },
              },
              required: ['role', 'goal'],
            },
          },
          confirmed: {
            type: 'boolean',
            description: 'MUST be true — set only after the user approved routing via ask_user. If false/omitted, the call is rejected.',
          },
          handoff_notes: { type: 'string', description: 'Optional notes the agent wants preserved across the routing handoff.' },
        },
        required: ['tasks', 'confirmed'],
        additionalProperties: false,
      },
    },
  },
];

// Tool name to implementation function mapping
export const TOOL_IMPLEMENTATIONS: Record<string, string> = {
  read_file: 'tools/builtin/files.readFile',
  read_files: 'tools/builtin/files.readFile',
  write_file: 'tools/builtin/files.writeFile',
  patch: 'tools/builtin/files.patchFile',
  edit_file: 'tools/builtin/files.patchFile',
  search_files: 'tools/builtin/files.searchFiles',
  list_files: 'tools/builtin/files.listFiles',
  terminal: 'tools/builtin/terminal.execute',
  shell: 'tools/builtin/terminal.execute',
  bash: 'tools/builtin/terminal.execute',
  cmd: 'tools/builtin/terminal.execute',
  run_command: 'tools/builtin/terminal.execute',
  exec_command: 'tools/builtin/terminal.execute',
  git_diff: 'tools/builtin/git.diff',
  git_status: 'tools/builtin/git.status',
  todo: 'tools/builtin/todo.manage',
  web_search: 'tools/builtin/web.search',
  fetch_url: 'tools/builtin/web.fetchUrl',
  delegate_task: 'tools/builtin/delegation.manage',
  route_task: 'tools/builtin/route.routeTask',
  index_codebase: 'tools/builtin/indexing.index_codebase',
  find_symbol: 'tools/builtin/indexing.find_symbol',
  get_definition: 'tools/builtin/indexing.get_definition',
  get_references: 'tools/builtin/indexing.get_references',
  get_call_graph: 'tools/builtin/indexing.get_call_graph',
  lsp_diagnostics: 'tools/builtin/lsp.lspDiagnostics',
  lsp_hover: 'tools/builtin/lsp.lspHover',
  lsp_rename: 'tools/builtin/lsp.lspRename',
  screenshot_page: 'tools/builtin/screenshot.screenshotPage',
  get_impact: 'tools/builtin/impact.getImpact',
  watch_process: 'tools/builtin/process-watcher.watchProcess',
  read_process: 'tools/builtin/process-watcher.readProcess',
  kill_process: 'tools/builtin/process-watcher.killProcess',
  eval_code: 'tools/builtin/eval.evalCode',
  ask_user: 'tools/builtin/ask_user.askUser',
  propose_skill: 'tools/builtin/propose_skill.proposeSkill',
  system_info: 'tools/builtin/system.systemInfo',
  generate_image: 'tools/builtin/image.generateImage',
  handoff_task: 'tools/builtin/handoff.handoffTask',
  set_context_variable: 'tools/builtin/handoff.setContextVariable',
  get_context_variable: 'tools/builtin/handoff.getContextVariable',
};