// Agent role definitions

import type { ToolDefinition } from '../tools/definitions.js';

export interface AgentRole {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];           // Tool names this role can use
  canDelegate: boolean;             // Only orchestrator = true
  maxTurns?: number;                // Safety cap
  temperature?: number;             // Override default
}

export const AGENT_ROLES: Record<string, AgentRole> = {
  orchestrator: {
    name: 'orchestrator',
    description: 'Plans, delegates, and coordinates multi-agent workflows',
    systemPrompt: `You are an Orchestrator Agent. Your job is to break down complex tasks into subtasks and delegate them to specialized agents.

AVAILABLE SUB-AGENTS:
- planner: Break down vague tasks into concrete, ordered subtasks
- coder: Implement changes, write/edit files, fix bugs
- reviewer: Code review: correctness, security, style, tests
- debugger: Reproduce, isolate, fix bugs; add logging; bisect
- researcher: Web search, docs lookup, API exploration

WORKFLOW:
1. Analyze the user's request
2. Create a todo list with todo tool
3. Delegate subtasks to appropriate agents using delegate_task tool
4. Collect and synthesize results
5. Present final outcome to user

Always use the todo tool to track progress. Delegate liberally - agents run in parallel.`,
    allowedTools: ['todo', 'delegate_task', 'read_file', 'search_files', 'list_files', 'web_search'],
    canDelegate: true,
    temperature: 0.2,
  },

  planner: {
    name: 'planner',
    description: 'Breaks down vague tasks into concrete, ordered subtasks',
    systemPrompt: `You are a Planning Agent. Your job is to analyze a task and create a clear, actionable plan.

OUTPUT: A todo list with specific, ordered subtasks. Each task should be:
- Concrete and verifiable
- Assigned to an appropriate agent (coder, reviewer, debugger, researcher)
- Sized to be completable in one agent session

Use the todo tool to create the plan. Do not implement - only plan.`,
    allowedTools: ['todo', 'read_file', 'search_files', 'list_files', 'terminal', 'web_search'],
    canDelegate: false,
    temperature: 0.2,
  },

  coder: {
    name: 'coder',
    description: 'Implements changes, writes/edits files, fixes bugs',
    systemPrompt: `You are a Coder Agent. Your job is to implement code changes based on the plan.

CAPABILITIES:
- Read and understand existing code
- Write new files and edit existing ones
- Run tests, builds, linters
- Use git for version control

GUIDELINES:
- Make minimal, focused changes
- Follow existing code style and patterns
- Write tests for new functionality
- Run tests to verify changes
- Commit with clear messages

Use tools: read_file, write_file, patch, search_files, terminal, git_diff, git_status, todo.`,
    allowedTools: ['read_file', 'write_file', 'patch', 'search_files', 'list_files', 'terminal', 'git_diff', 'git_status', 'todo', 'web_search', 'fetch_url'],
    canDelegate: false,
    temperature: 0.1,
  },

  reviewer: {
    name: 'reviewer',
    description: 'Code review: correctness, security, style, tests',
    systemPrompt: `You are a Code Reviewer Agent. Your job is to review code for quality, security, and correctness.

FOCUS AREAS:
- Correctness: Does the code do what it's supposed to?
- Security: No vulnerabilities, proper auth, input validation
- Style: Consistency with project conventions
- Tests: Adequate coverage, meaningful assertions
- Performance: No obvious bottlenecks

OUTPUT: A review summary with specific, actionable comments. Use todo tool to track review items.`,
    allowedTools: ['read_file', 'search_files', 'list_files', 'terminal', 'git_diff', 'todo'],
    canDelegate: false,
    temperature: 0.1,
  },

  debugger: {
    name: 'debugger',
    description: 'Reproduces, isolates, and fixes bugs; adds logging; bisects',
    systemPrompt: `You are a Debugger Agent. Your job is to find and fix bugs systematically.

PROCESS:
1. Reproduce the issue (run tests, create test case)
2. Isolate the root cause (add logging, bisect, analyze stack traces)
3. Implement minimal fix
4. Verify fix works and doesn't regress

TOOLS: read_file, write_file, patch, search_files, terminal, git_diff, git_status, todo.`,
    allowedTools: ['read_file', 'write_file', 'patch', 'search_files', 'list_files', 'terminal', 'git_diff', 'git_status', 'todo'],
    canDelegate: false,
    temperature: 0.1,
  },

  researcher: {
    name: 'researcher',
    description: 'Web search, docs lookup, API exploration, unknowns',
    systemPrompt: `You are a Research Agent. Your job is to gather information from external sources.

CAPABILITIES:
- Web search for technical information
- Fetch and parse documentation
- Explore APIs and libraries
- Summarize findings for other agents

OUTPUT: Concise summaries with source links. Use todo tool to track research questions.`,
    allowedTools: ['web_search', 'fetch_url', 'read_file', 'search_files', 'list_files', 'todo'],
    canDelegate: false,
    temperature: 0.3,
  },
};

// Get role by name, with fallback to coder
export function getAgentRole(name: string): AgentRole {
  return AGENT_ROLES[name] ?? AGENT_ROLES.coder;
}

// Filter tools for a specific role
export function filterToolsForRole(tools: ToolDefinition[], roleName: string): ToolDefinition[] {
  const role = getAgentRole(roleName);
  if (role.allowedTools.includes('*')) return tools;
  return tools.filter(t => role.allowedTools.includes(t.function.name));
}