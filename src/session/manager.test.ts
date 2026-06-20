import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionManager } from './manager.js';

describe('SessionManager', () => {
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-manager-test-'));
    process.chdir(tmpDir);
    vi.stubEnv('HOME', tmpDir);
    vi.stubEnv('USERPROFILE', tmpDir);
    manager = new SessionManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    manager = null!;
    process.chdir(os.tmpdir());
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { }
    }
    vi.unstubAllEnvs();
  });

  it('init creates directories and index database', () => {
    manager.init();
    expect(fs.existsSync(path.join(tmpDir, '.daedalus', 'sessions'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.daedalus', 'memory'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.daedalus', 'sessions', 'index.sqlite'))).toBe(true);
  });

  it('startSession creates a new session with id and title', () => {
    manager.init();
    const session = manager.startSession();
    expect(session.sessionId).toBeTruthy();
    expect(session.turns).toEqual([]);
    expect(session.activeFiles.size).toBe(0);
    expect(session.todos).toEqual([]);
  });

  it('startSession loads existing session when sessionId is provided', () => {
    manager.init();
    const created = manager.startSession();
    const loaded = manager.startSession(created.sessionId);
    expect(loaded.sessionId).toBe(created.sessionId);
  });

  it('saveSessionState persists messages, files, and todos', () => {
    manager.init();
    const session = manager.startSession();

    const messages = [
      { role: 'system' as const, content: 'sys prompt' },
      { role: 'user' as const, content: 'hello' },
    ];
    const activeFiles = new Map([['/test/file.ts', 'file.ts']]);
    const todos = [{ id: '1', content: 'test', status: 'pending' }];

    manager.saveSessionState(messages, activeFiles, todos as any);

    const loaded = manager.startSession(session.sessionId);
    expect(loaded.turns).toHaveLength(2);
    expect(loaded.activeFiles.size).toBe(1);
    expect(loaded.todos).toHaveLength(1);
  });

  it('getSessionsForProject returns session list', () => {
    manager.init();
    manager.startSession();
    const sessions = manager.getSessionsForProject();
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('getChatMessages returns formatted chat messages', () => {
    manager.init();
    manager.startSession();

    manager.saveSessionState(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', tool_calls: [{ id: '1', type: 'function', function: { name: 'test', arguments: '{}' } }] },
      ],
      new Map(),
      []
    );

    const msgs = manager.getChatMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
  });

  it('deleteSession removes db and jsonl files', () => {
    manager.init();
    const session = manager.startSession();
    manager.saveSessionState([{ role: 'user', content: 'x' }], new Map(), [] as any);
    manager.deleteSession(session.sessionId);

    const serviceDir = path.join(tmpDir, '.daedalus', 'sessions', manager.projectHash);
    expect(fs.existsSync(path.join(serviceDir, `${session.sessionId}.sqlite`))).toBe(false);
  });

  it('addFact and setConvention delegate to memory module', () => {
    manager.init();
    manager.startSession();
    manager.addFact('framework', 'vitest');
    manager.setConvention('style', 'no comments');
    const mem = manager.loadMemory();
    expect(mem.facts.length).toBeGreaterThan(0);
    expect(mem.conventions.style).toBe('no comments');
  });

  it('getMemoryPrompt returns non-empty after adding facts', () => {
    manager.init();
    manager.startSession();
    manager.addFact('lang', 'typescript');
    const prompt = manager.getMemoryPrompt();
    expect(prompt).toContain('typescript');
  });

  it('importSessionFromJsonl loads turns from JSONL', () => {
    manager.init();
    manager.startSession();
    const jsonlPath = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(jsonlPath, JSON.stringify({ turn: 1, role: 'user', content: 'imported' }) + '\n', 'utf8');
    const turns = manager.importSessionFromJsonl(jsonlPath);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('imported');
  });

  it('importSessionFromJsonl throws without active session', () => {
    const freshManager = new SessionManager(tmpDir);
    freshManager.init();
    expect(() => freshManager.importSessionFromJsonl('test.jsonl')).toThrow('No active session');
  });

});
