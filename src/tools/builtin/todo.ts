// Todo management tool

import { ToolContext, ToolResult } from '../../types.js';

// In-memory todo store (will be replaced with session persistence later)
const state: { store: Map<string, Array<{ id: string; content: string; status: string }>> } = {
  store: new Map(),
};

export function getSessionTodos(sessionId: string): Array<{ id: string; content: string; status: string }> {
  return state.store.get(sessionId) ?? [];
}

export function setSessionTodos(sessionId: string, todos: Array<{ id: string; content: string; status: string }>) {
  state.store.set(sessionId, todos);
}

export function buildTodoContext(sessionId: string): string {
  const todos = getSessionTodos(sessionId);
  const activeTodos = todos.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
  if (activeTodos.length === 0) return '';
  const lines = activeTodos.map(t => {
    const icon = t.status === 'in_progress' ? '[/]' : '[ ]';
    return `${icon} ${t.id}: ${t.content}`;
  });
  return `\n--- ACTIVE SESSION TODOS ---\n${lines.join('\n')}\n----------------------------\n`;
}

export async function manage(args: { todos: Array<{ id: string; content: string; status: string }>; merge?: boolean }, context: ToolContext): Promise<ToolResult> {
  const sessionKey = context.sessionId;
  const existing = state.store.get(sessionKey) ?? [];

  let updated: Array<{ id: string; content: string; status: string }>;
  if (args.merge) {
    const byId = new Map(existing.map(t => [t.id, t]));
    for (const t of args.todos) {
      const prev = byId.get(t.id);
      if (prev) {
        byId.set(t.id, { ...prev, ...t });
      } else {
        byId.set(t.id, { id: t.id, content: t.content || '', status: t.status });
      }
    }
    updated = Array.from(byId.values());
  } else {
    updated = args.todos.map(t => ({ id: t.id, content: t.content || '', status: t.status }));
  }

  state.store.set(sessionKey, updated);

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