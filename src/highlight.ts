import { highlight } from 'cli-highlight';
import pc from 'picocolors';

const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;

export function hasCodeBlocks(text: string): boolean {
  return CODE_BLOCK_RE.test(text);
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

export function highlightCodeBlocks(text: string): string {
  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(CODE_BLOCK_RE)) {
    const lang = match[1] || 'text';
    const code = match[2];
    const fullMatch = match[0];
    const matchIndex = match.index ?? 0;

    // Text before this code block
    result += text.slice(lastIndex, matchIndex);

    // Syntax-highlighted code block
    let highlighted: string;
    try {
      highlighted = highlight(code, {
        language: lang,
        ignoreIllegals: true,
      });
    } catch {
      highlighted = code;
    }

    result += pc.dim('```') + (lang ? pc.dim(lang) : '') + '\n';
    result += highlighted;
    result += pc.dim('```');

    lastIndex = matchIndex + fullMatch.length;
  }

  // Remaining text after last code block
  result += text.slice(lastIndex);

  return result;
}
