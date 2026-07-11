import { describe, it, expect, vi } from 'vitest';
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

  it('auto-names session with valid title from model', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'fix the bug' },
      { role: 'assistant', content: 'I have successfully patched the file and the bug is now fixed.' },
    ];

    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Bug Fix Session' } }],
          }),
        },
      },
    };

    const mockSessionManager = {
      sessionTitle: 'New Session',
      loadMemory: vi.fn().mockReturnValue({ facts: [] }),
      addFact: vi.fn(),
      updateSessionTitle: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);
    expect(mockRouter.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(mockSessionManager.updateSessionTitle).toHaveBeenCalledWith('Bug Fix Session');
  });

  it('skips invalid titles and does not rename session', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hello! How can I help you today? I am ready to assist with your coding tasks and answer any questions you might have.' },
    ];

    const mockRouter = {
      chat: {
        completions: {
          create: vi
            .fn()
            .mockResolvedValueOnce({
              choices: [{ message: { content: 'Generate a very short, concise title for this conversation' } }],
            })
            .mockResolvedValueOnce({
              choices: [{ message: { content: 'Descriptive Title Here' } }],
            }),
        },
      },
    };

    const mockSessionManager = {
      sessionTitle: 'New Session',
      loadMemory: vi.fn().mockReturnValue({ facts: [] }),
      addFact: vi.fn(),
      updateSessionTitle: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);
    expect(mockRouter.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(mockSessionManager.updateSessionTitle).not.toHaveBeenCalled();
  });

  it('does not auto-name when there are no user messages', async () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'hi' },
    ];

    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };

    const mockSessionManager = {
      sessionTitle: 'New Session',
      loadMemory: vi.fn().mockReturnValue({ facts: [] }),
      addFact: vi.fn(),
      updateSessionTitle: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);
    expect(mockRouter.chat.completions.create).not.toHaveBeenCalled();
    expect(mockSessionManager.updateSessionTitle).not.toHaveBeenCalled();
  });

  it('does not auto-name custom-titled sessions', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };

    const mockSessionManager = {
      sessionTitle: 'My Custom Title',
      loadMemory: vi.fn().mockReturnValue({ facts: [] }),
      addFact: vi.fn(),
      updateSessionTitle: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);
    expect(mockRouter.chat.completions.create).not.toHaveBeenCalled();
    expect(mockSessionManager.updateSessionTitle).not.toHaveBeenCalled();
  });

  it('correctly parses JSON with nested brackets in values', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'use a custom witty opener for this function' },
      { role: 'assistant', content: 'Sure, I will use [Witty opener] at the beginning.' },
      { role: 'user', content: 'looks good, commit it.' },
      { role: 'assistant', content: 'Done.', tool_calls: [{ id: '1', type: 'function', function: { name: 'git_commit', arguments: '{}' } }] },
    ];

    const nestedJson = '[{"key":"witty opener style","value":"[Witty opener]"}]';

    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: `Here is the JSON:\n${nestedJson}\nHope that helps!` } }],
          }),
        },
      },
    };

    const mockSessionManager = {
      sessionTitle: 'Witty Session',
      loadMemory: vi.fn().mockReturnValue({ facts: [] }),
      addFact: vi.fn(),
      updateSessionTitle: vi.fn(),
    };

    await extractAndSave(mockRouter as any, mockSessionManager as any, messages);
    expect(mockSessionManager.addFact).toHaveBeenCalledWith('witty opener style', '[Witty opener]', 'agent');
  });

});
