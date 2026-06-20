import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractAndSave } from './extraction.js';
import type { ChatMessage } from './types.js';

describe('Fact extraction', () => {

  it('detects learning signals from tool calls', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'fix the bug' },
      {
        role: 'assistant',
        content: 'I will patch the file',
        tool_calls: [
          { id: '1', type: 'function', function: { name: 'patch', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'patched', tool_call_id: '1' },
    ];

    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: '[{"key":"test framework","value":"vitest"}]' } }],
          }),
        },
      },
    };

    const mockSessionManager = {
      loadMemory: vi.fn().mockReturnValue({ facts: [] }),
      addFact: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);

    expect(mockRouter.chat.completions.create).toHaveBeenCalled();
    expect(mockSessionManager.addFact).toHaveBeenCalledWith('test framework', 'vitest', 'agent');
  });

  it('skips extraction on turn with no learning signals', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];

    const mockRouter = {
      chat: {
        completions: { create: vi.fn() },
      },
    };
    const mockSessionManager = {
      loadMemory: vi.fn(),
      addFact: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);
    expect(mockRouter.chat.completions.create).not.toHaveBeenCalled();
  });

  it('deduplicates against existing facts', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'we use vitest' },
      {
        role: 'assistant',
        content: 'ok',
        tool_calls: [
          { id: '1', type: 'function', function: { name: 'patch', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'done', tool_call_id: '1' },
    ];

    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: '[{"key":"framework","value":"vitest"}]' } }],
          }),
        },
      },
    };

    const mockSessionManager = {
      loadMemory: vi.fn().mockReturnValue({
        facts: [{ key: 'framework', value: 'vitest', source: 'user', created: 1 }],
      }),
      addFact: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);
    expect(mockSessionManager.addFact).not.toHaveBeenCalled();
  });

  it('handles router failure gracefully', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: 'y',
        tool_calls: [
          { id: '1', type: 'function', function: { name: 'write_file', arguments: '{}' } },
        ],
      },
    ];

    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('API error')),
        },
      },
    };

    const mockSessionManager = {
      loadMemory: vi.fn().mockReturnValue({ facts: [] }),
      addFact: vi.fn(),
    };

    await expect(extractAndSave(mockRouter as any, mockSessionManager as any, messages)).resolves.not.toThrow();
  });

  it('cleans non-standard JSON formats', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'use vitest' },
      {
        role: 'assistant',
        content: 'ok',
        tool_calls: [
          { id: '1', type: 'function', function: { name: 'patch', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'done', tool_call_id: '1' },
    ];

    const relaxedJson = `[\n      // inline comment\n      {\n        key: 'framework', /* block comment */\n        value: 'vitest',\n      },\n    ]`;

    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: relaxedJson } }],
          }),
        },
      },
    };

    const mockSessionManager = {
      loadMemory: vi.fn().mockReturnValue({ facts: [] }),
      addFact: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);
    expect(mockSessionManager.addFact).toHaveBeenCalledWith('framework', 'vitest', 'agent');
  });

});
