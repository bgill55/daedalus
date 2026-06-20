import { describe, it, expect } from 'vitest';
import { hasCodeBlocks, countLines, highlightCodeBlocks } from './highlight.js';

describe('Code highlighting utilities', () => {
  describe('hasCodeBlocks', () => {
    it('returns true when text contains multiline code blocks', () => {
      expect(hasCodeBlocks('some text ```\ncode\n``` more')).toBe(true);
    });

    it('returns false when text has no code blocks', () => {
      expect(hasCodeBlocks('just plain text')).toBe(false);
    });

    it('returns true for code blocks with language', () => {
      expect(hasCodeBlocks('text ```ts\nconst x = 1;\n``` end')).toBe(true);
    });

    it('returns false for empty text', () => {
      expect(hasCodeBlocks('')).toBe(false);
    });
  });

  describe('countLines', () => {
    it('counts lines in a string', () => {
      expect(countLines('a\nb\nc')).toBe(3);
    });

    it('returns 0 for empty string', () => {
      expect(countLines('')).toBe(0);
    });

    it('handles single line', () => {
      expect(countLines('hello')).toBe(1);
    });

    it('handles trailing newline', () => {
      expect(countLines('a\nb\n')).toBe(3);
    });
  });

  describe('highlightCodeBlocks', () => {
    it('passes through text without code blocks', () => {
      const input = 'hello world';
      expect(highlightCodeBlocks(input)).toBe(input);
    });

    it('highlights a code block with language', () => {
      const result = highlightCodeBlocks('```ts\nconst x = 1\n```');
      expect(result).toContain('const');
      expect(result).toContain('x');
    });

    it('highlights a code block without language', () => {
      const result = highlightCodeBlocks('```\nplain text\n```');
      expect(result).toContain('plain text');
    });

    it('handles multiple code blocks', () => {
      const result = highlightCodeBlocks('a ```\none\n``` b ```\ntwo\n``` c');
      expect(result).toContain('one');
      expect(result).toContain('two');
    });

    it('returns the same text for empty input', () => {
      expect(highlightCodeBlocks('')).toBe('');
    });
  });
});
