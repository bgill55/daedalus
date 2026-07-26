import { describe, it, expect } from 'vitest';
import {
  detectShell,
  resolveOsName,
  getSystemDiagnostics,
  getSystemPromptHeader,
} from './systemInfo.js';

describe('System Diagnostics Module', () => {
  it('detects shell correctly based on platform', () => {
    expect(detectShell('win32')).toBeDefined();
    expect(detectShell('darwin')).toBeDefined();
    expect(detectShell('linux')).toBeDefined();
  });

  it('resolves OS release names', () => {
    expect(resolveOsName('win32', '10.0.22631')).toContain('Windows');
    expect(resolveOsName('darwin', '23.4.0')).toContain('macOS');
    expect(resolveOsName('linux', '6.5.0')).toContain('Linux');
  });

  it('retrieves valid system diagnostics', () => {
    const diag = getSystemDiagnostics();
    expect(diag.platform).toBeDefined();
    expect(diag.osName).toBeDefined();
    expect(diag.arch).toBeDefined();
    expect(diag.shell).toBeDefined();
    expect(diag.cpus).toBeGreaterThan(0);
    expect(diag.totalMemoryGB).toBeGreaterThan(0);
    expect(diag.freeMemoryGB).toBeGreaterThanOrEqual(0);
    expect(diag.pathSeparator).toBeDefined();
  });

  it('generates a formatted system prompt header', () => {
    const header = getSystemPromptHeader();
    expect(header).toContain('[System Diagnostics]');
    expect(header).toContain('OS:');
    expect(header).toContain('Shell:');
    expect(header).toContain('CPUs:');
    expect(header).toContain('RAM:');
  });
});
