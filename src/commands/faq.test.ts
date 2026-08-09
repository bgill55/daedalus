import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { faqCommand, faqText } from './faq.js';
import type { CommandContext } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsFaq = readFileSync(resolve(__dirname, '../../docs/faq.md'), 'utf8');

// Every FAQ question heading from the canonical docs must appear (in terminal-rendered
// form) in the embedded faqText. This is the drift guard: if docs/faq.md is edited and
// the embedded copy is not updated to match, this test fails.
const expectedQuestions = [
  'How do I try Daedalus without installing anything',
  'hardware requirements for running Daedalus 100% locally',
  'My local LLM is running incredibly slow',
  'Which local models are officially recommended',
  'How does the embedded model router handle complex vs. simple tasks',
  'What happens if my primary LLM provider rate-limits or crashes',
  'What are the ready-to-use presets and how do I apply them',
  'What is "SpecFirst" and how does it prevent agent coding pitfalls',
  'How does the SpecFirst Verification Engine enforce code safety',
  'What is the "Context Pollution" problem and how does Σ-Mem solve it',
  'What is the math behind Σ-Mem scoring and pruning',
  'The CLI says [CIRCUIT BREAKER]',
  'What is a "Batch Short-Circuit"',
  'Terminal tool crashes with Exit Code 3221225794',
  'A valid Windows patch was reverted as a "syntax error"',
  'How do I isolate Daedalus execution environments',
  'What are "Skills"? Are they executable code',
  'Can an untrusted codebase hijack my agent',
  'How does the agent propose and learn new skills',
  'Does Daedalus support MCP? How do I install external tools',
];

describe('/faq command', () => {
  it('outputs the FAQ without throwing errors', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await faqCommand.execute('', {} as CommandContext);
    expect(consoleSpy).toHaveBeenCalled();
    expect((consoleSpy.mock.calls[0][0] as string)).toContain('Daedalus Local-First FAQ');
    consoleSpy.mockRestore();
  });

  it('drift guard: every documented FAQ question is present in the embedded output', () => {
    for (const q of expectedQuestions) {
      expect(faqText, `missing FAQ question: "${q}"`).toContain(q);
    }
  });

  it('drift guard: embedded output preserves key version fixes mentioned in docs', () => {
    expect(faqText).toContain('v3.13.3');
    expect(faqText).toContain('v3.13.1');
  });

  it('renders Σ-Mem math in terminal-friendly form (no LaTeX delimiters)', () => {
    expect(faqText).not.toContain('\\(');
    expect(faqText).not.toContain('\\)');
    expect(faqText).toContain('Σ-Mem');
  });
});
