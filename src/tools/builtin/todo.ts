// Todo management tool

import { ToolContext, ToolResult } from '../../types.js';

// In-memory todo store (will be replaced with session persistence later)
const todoStore = new Map<string, Array<{ id: string; content: string; status: string }>>();

export function getSessionTodos(sessionId: string): Array<{ id: string; content: string; status: string }> {
  return todoStore.get(sessionId) ?? [];
}

export function setSessionTodos(sessionId: string, todos: Array<{ id: string; content: string; status: string }>) {
  todoStore.set(sessionId, todos);
}

export async function manage(args: { todos: Array<{ id: string; content: string; status: string }>; merge?: boolean }, context: ToolContext): Promise<ToolResult> {
  const sessionKey = context.sessionId;
  const existing = todoStore.get(sessionKey) ?? [];

  let updated: Array<{ id: string; content: string; status: string }>;
  if (args.merge) {
    const byId = new Map(existing.map(t => [t.id, t]));
    for (const t of args.todos) {
      byId.set(t.id, t);
    }
    updated = Array.from(byId.values());
  } else {
    updated = args.todos;
  }

  todoStore.set(sessionKey, updated);

  const lines = updated.map(t => {
    const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : t.status === 'cancelled' ? '✗' : '○';
    return `  ${icon} ${t.id}: ${t.content}`;
  });

  return {
    toolCallId: '',
    name: 'todo',
    success: true,
    content: `Todo list (${updated.length} items):\n${lines.join('\n')}`,
  };
}