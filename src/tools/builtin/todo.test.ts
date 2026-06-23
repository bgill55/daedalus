import { describe, it, expect, beforeEach } from 'vitest';
import { manage, getSessionTodos, setSessionTodos } from './todo.js';
import type { ToolContext } from '../../types.js';

describe('Todo tool', () => {

  const mockContext: ToolContext = {
    sessionId: 'test-session-todo',
  } as ToolContext;

  beforeEach(() => {
    setSessionTodos(mockContext.sessionId, []);
  });

  it('creates a new todo list', async () => {
    const result = await manage({
      todos: [
        { id: '1', content: 'First task', status: 'pending' },
        { id: '2', content: 'Second task', status: 'in_progress' },
      ],
    }, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain('First task');
    expect(result.content).toContain('Second task');
  });

  it('merges with existing todos', async () => {
    setSessionTodos(mockContext.sessionId, [
      { id: '1', content: 'Existing', status: 'pending' },
    ]);

    const result = await manage({
      todos: [
        { id: '2', content: 'New task', status: 'pending' },
        { id: '1', content: 'Updated existing', status: 'completed' },
      ],
      merge: true,
    }, mockContext);

    expect(result.success).toBe(true);
    const todos = getSessionTodos(mockContext.sessionId);
    expect(todos).toHaveLength(2);
    expect(todos.find(t => t.id === '1')!.status).toBe('completed');
  });

  it('replaces existing todos when merge is false', async () => {
    setSessionTodos(mockContext.sessionId, [
      { id: 'old', content: 'Should be gone', status: 'pending' },
    ]);

    await manage({
      todos: [
        { id: 'new', content: 'Replacement', status: 'completed' },
      ],
      merge: false,
    }, mockContext);

    const todos = getSessionTodos(mockContext.sessionId);
    expect(todos).toHaveLength(1);
    expect(todos[0].id).toBe('new');
  });

  it('shows status icons for each todo', async () => {
    const result = await manage({
      todos: [
        { id: 'a', content: 'Pending', status: 'pending' },
        { id: 'b', content: 'Active', status: 'in_progress' },
        { id: 'c', content: 'Done', status: 'completed' },
        { id: 'd', content: 'Cancelled', status: 'cancelled' },
      ],
    }, mockContext);

    expect(result.content).toContain('○');
    expect(result.content).toContain('▶');
    expect(result.content).toContain('✓');
    expect(result.content).toContain('✗');
  });

});
