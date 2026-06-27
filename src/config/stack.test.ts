import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectProjectStack } from './stack.js';

const tempDirs: string[] = [];

function createTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-stack-test-'));
  tempDirs.push(dir);
  for (const [filepath, content] of Object.entries(files)) {
    const fullpath = path.join(dir, filepath);
    fs.mkdirSync(path.dirname(fullpath), { recursive: true });
    fs.writeFileSync(fullpath, content, 'utf8');
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

describe('detectProjectStack', () => {
  it('detects a React TypeScript project via package.json', () => {
    const root = createTempProject({
      'package.json': JSON.stringify({
        dependencies: { react: '^18.2.0', next: '^14.0.0' },
        scripts: { dev: 'next dev', build: 'next build' }
      }),
      'tsconfig.json': '{}'
    });
    const result = detectProjectStack(root);
    expect(result).toContain('Language/Environment: JavaScript/Node.js (TypeScript)');
    expect(result).toContain('Frameworks/Libraries: React, Next.js');
    expect(result).toContain('Available Scripts: dev, build');
  });

  it('detects a Python project', () => {
    const root = createTempProject({
      'requirements.txt': 'numpy\npandas'
    });
    const result = detectProjectStack(root);
    expect(result).toContain('Language/Environment: Python');
  });

  it('detects a Rust project', () => {
    const root = createTempProject({
      'Cargo.toml': '[package]\nname = "test"'
    });
    const result = detectProjectStack(root);
    expect(result).toContain('Language/Environment: Rust (Cargo)');
  });

  it('detects a Go project', () => {
    const root = createTempProject({
      'go.mod': 'module test'
    });
    const result = detectProjectStack(root);
    expect(result).toContain('Language/Environment: Go');
  });

  it('detects a Vanilla JS web page', () => {
    const root = createTempProject({
      'index.html': '<html></html>'
    });
    const result = detectProjectStack(root);
    expect(result).toContain('Language/Environment: Frontend web page (HTML/CSS)');
    expect(result).toContain('Frameworks/Libraries: None (Vanilla HTML5 / CSS3 / JavaScript)');
  });

  it('returns empty string if nothing matches', () => {
    const root = createTempProject({});
    const result = detectProjectStack(root);
    expect(result).toBe('');
  });
});
