import { describe, it, expect, vi } from 'vitest';
import { spawn, execSync } from 'child_process';
import { spawnDetached, execSafe } from './spawn.js';

vi.mock('child_process', () => {
  const actual = vi.importActual('child_process');
  return {
    ...actual,
    spawn: vi.fn(),
    execSync: vi.fn(),
  };
});

describe('spawnDetached', () => {
  it('ignores stdin and detaches on win32 by default', () => {
    (spawn as any).mockReturnValue({} as any);
    spawnDetached('node', ['-v']);
    expect(spawn).toHaveBeenCalledWith(
      'node',
      ['-v'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform === 'win32',
      }),
    );
  });

  it('respects explicit stdio/detached overrides', () => {
    (spawn as any).mockReturnValue({} as any);
    spawnDetached('rg', ['x'], { stdio: 'inherit', detached: false });
    expect(spawn).toHaveBeenCalledWith(
      'rg',
      ['x'],
      expect.objectContaining({ stdio: 'inherit', detached: false }),
    );
  });
});

describe('execSafe', () => {
  it('ignores stdin by default while preserving stdout capture', () => {
    (execSync as any).mockReturnValue('out');
    const result = execSafe('git log', { encoding: 'utf8' });
    expect(execSync).toHaveBeenCalledWith(
      'git log',
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    expect(result).toBe('out');
  });
});
