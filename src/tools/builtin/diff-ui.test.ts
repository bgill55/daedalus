import { describe, it, expect, vi, afterEach } from 'vitest';
import * as diffUI from './diff-ui.js';

describe('Diff UI / Chunk Staging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should format a hunk correctly with colored lines and line numbers', () => {
    const hunk = {
      oldStart: 2,
      oldLines: 2,
      newStart: 2,
      newLines: 3,
      lines: [
        ' line 1',
        '-line 2',
        '+line 2 - changed',
        '+line 2.5 - added',
        ' line 3'
      ]
    };
    const formatted = diffUI.formatHunk(hunk, 0, 1, 'test.txt');
    expect(formatted).toContain('Hunk 1 of 1 for test.txt');
    expect(formatted).toContain('-    3 | line 2');
    expect(formatted).toContain('+    3 | line 2 - changed');
    expect(formatted).toContain('+    4 | line 2.5 - added');
  });

  it('should reconstruct file content accepting or rejecting chunks', async () => {
    const oldLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const newLines = [...oldLines];
    newLines[1] = 'line 2 - changed';
    newLines[94] = 'line 95 - changed';

    const oldContent = oldLines.join('\n');
    const newContent = newLines.join('\n');

    const mockPrompter = vi.fn()
      .mockResolvedValueOnce('yes')
      .mockResolvedValueOnce('no');

    const result = await diffUI.reviewChunksWorkflow(oldContent, newContent, 'test.txt', mockPrompter);

    const expectedLines = [...oldLines];
    expectedLines[1] = 'line 2 - changed'; // accepted
    // expectedLines[94] remains 'line 95' (rejected)

    expect(result).toBe(expectedLines.join('\n'));
    expect(mockPrompter).toHaveBeenCalledTimes(2);
  });

  it('should accept all remaining hunks when choice is "all"', async () => {
    const oldLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const newLines = [...oldLines];
    newLines[1] = 'line 2 - changed';
    newLines[94] = 'line 95 - changed';

    const oldContent = oldLines.join('\n');
    const newContent = newLines.join('\n');

    const mockPrompter = vi.fn().mockResolvedValueOnce('all');

    const result = await diffUI.reviewChunksWorkflow(oldContent, newContent, 'test.txt', mockPrompter);

    expect(result).toBe(newContent);
    expect(mockPrompter).toHaveBeenCalledTimes(1);
  });

  it('should reject all remaining hunks when choice is "quit"', async () => {
    const oldLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const newLines = [...oldLines];
    newLines[1] = 'line 2 - changed';
    newLines[94] = 'line 95 - changed';

    const oldContent = oldLines.join('\n');
    const newContent = newLines.join('\n');

    const mockPrompter = vi.fn()
      .mockResolvedValueOnce('yes')
      .mockResolvedValueOnce('quit');

    const result = await diffUI.reviewChunksWorkflow(oldContent, newContent, 'test.txt', mockPrompter);

    const expectedLines = [...oldLines];
    expectedLines[1] = 'line 2 - changed'; // accepted
    // expectedLines[94] remains 'line 95' (rejected due to quit)

    expect(result).toBe(expectedLines.join('\n'));
    expect(mockPrompter).toHaveBeenCalledTimes(2);
  });
});
