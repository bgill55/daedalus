// Session manager for Daedalus — persists conversations, active files, and todos

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { getProjectHash } from '../project-hash.js';
import {
  initIndexDb,
  initSessionDb,
  registerSession,
  listSessionsForProject,
  deleteSessionFromIndex,
  getTurns,
  clearTurns,
  saveTurn,
  saveActiveFiles,
  getActiveFiles,
  saveTodos,
  getTodos,
  saveState,
  getState,
  saveFailureLesson,
  getFailureLessons,
  incrementLessonUsed,
  saveProjectStatus,
  getProjectStatus,
  SqliteTurn,
  SqliteTodo,
  FailureLesson,
  ProjectStatus,
  SessionMeta
} from './sqlite.js';
import { exportToJsonl, importFromJsonl } from './jsonl.js';
import { loadMemory, addFact, setConvention, getMemoryAsPrompt, ProjectMemory } from './memory.js';
import { ChatMessage } from '../types.js';

export class SessionManager {
  private homedir = os.homedir();
  private baseDir = path.join(this.homedir, '.daedalus');
  private sessionsDir = path.join(this.baseDir, 'sessions');
  private memoryDir = path.join(this.baseDir, 'memory');
  private indexDbPath = path.join(this.sessionsDir, 'index.sqlite');

  private indexDb!: Database.Database;
  private sessionDb?: Database.Database;

  projectRoot!: string;
  projectHash!: string;
  public sessionId!: string;
  public sessionTitle: string = 'New Session';

  constructor(projectRoot = process.cwd()) {
    this.setProjectRoot(projectRoot);
  }

  public setProjectRoot(projectRoot: string): void {
    this.projectRoot = path.resolve(projectRoot);
    this.projectHash = getProjectHash(this.projectRoot);
  }

  public reopenIndexDb(): void {
    if (this.indexDb) {
      this.indexDb.close();
      this.indexDb = initIndexDb(this.indexDbPath);
    }
  }

  /** Initialize directories and the index database */
  public init(): void {
    if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
    if (!fs.existsSync(this.memoryDir)) fs.mkdirSync(this.memoryDir, { recursive: true });

    const projectSessionDir = path.join(this.sessionsDir, this.projectHash);
    if (!fs.existsSync(projectSessionDir)) fs.mkdirSync(projectSessionDir, { recursive: true });

    this.indexDb = initIndexDb(this.indexDbPath);
  }

  /** Start a new session or load an existing one */
  public startSession(sessionId?: string, title?: string): {
    sessionId: string;
    turns: ChatMessage[];
    activeFiles: Map<string, string>;
    todos: SqliteTodo[];
  } {
    const isNew = !sessionId;
    this.sessionId = sessionId || `session-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    this.sessionTitle = title || (isNew ? `Session on ${new Date().toLocaleDateString()}` : 'Loaded Session');

    const sessionDbPath = path.join(this.sessionsDir, this.projectHash, `${this.sessionId}.sqlite`);

    this.sessionDb = initSessionDb(sessionDbPath);

    // If it is a new session, register it in the index DB
    const now = Date.now();
    const meta: SessionMeta = {
      id: this.sessionId,
      project_path: this.projectRoot,
      project_hash: this.projectHash,
      title: this.sessionTitle,
      created_at: now,
      updated_at: now,
    };
    registerSession(this.indexDb, meta);

    // Load existing data
    const turns = this.getChatMessages();
    const files = getActiveFiles(this.sessionDb);
    const todos = getTodos(this.sessionDb);

    return {
      sessionId: this.sessionId,
      turns,
      activeFiles: files,
      todos,
    };
  }

  /** Get all chat messages formatted for OpenAI SDK compatibility */
  public getChatMessages(): ChatMessage[] {
    if (!this.sessionDb) return [];
    const dbTurns = getTurns(this.sessionDb);
    return dbTurns.map(t => {
      let toolCallsParsed: any[] | undefined = undefined;
      if (t.tool_calls) {
        try {
          toolCallsParsed = JSON.parse(t.tool_calls);
        } catch {
          // Ignored
        }
      }
      let contentParsed = t.content;
      if (typeof t.content === 'string' && (t.content.startsWith('[') || t.content.startsWith('{'))) {
        try {
          contentParsed = JSON.parse(t.content);
        } catch {
          // Ignored
        }
      }
      return {
        role: t.role as 'system' | 'user' | 'assistant' | 'tool',
        content: contentParsed,
        tool_calls: toolCallsParsed,
        tool_call_id: t.tool_call_id || undefined,
        name: t.name || undefined,
      };
    });
  }

  /** Save the current session state (turns, active files, and todos) */
  public saveSessionState(
    messages: ChatMessage[],
    activeFiles: Map<string, string>,
    todos: SqliteTodo[]
  ): void {
    if (!this.sessionDb || !this.indexDb) return;

    // 1. Save turns to SQLite
    this.sessionDb.transaction(() => {
      clearTurns(this.sessionDb!);
      messages.forEach(msg => {
        const turn: SqliteTurn = {
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          tool_calls: msg.tool_calls ? JSON.stringify(msg.tool_calls) : undefined,
          tool_call_id: msg.tool_call_id,
          name: msg.name,
          model: (msg as ChatMessage & { model?: string; tokens?: { in?: number; out?: number }; latency_ms?: number }).model || undefined,
          tokens_input: (msg as ChatMessage & { tokens?: { in?: number; out?: number } }).tokens?.in || undefined,
          tokens_output: (msg as ChatMessage & { tokens?: { in?: number; out?: number } }).tokens?.out || undefined,
          latency_ms: (msg as ChatMessage & { latency_ms?: number }).latency_ms || undefined,
        };
        saveTurn(this.sessionDb!, turn);
      });
    })();

    // 2. Save active files
    saveActiveFiles(this.sessionDb, activeFiles);

    // 3. Save todos
    saveTodos(this.sessionDb, todos);

    // 4. Update the index DB — preserve the original created_at timestamp
    const now = Date.now();
    const existing = this.getSessionsForProject().find(s => s.id === this.sessionId);
    const meta: SessionMeta = {
      id: this.sessionId,
      project_path: this.projectRoot,
      project_hash: this.projectHash,
      title: this.sessionTitle,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    registerSession(this.indexDb, meta);

    // 5. Export to JSONL for portability
    const jsonlPath = path.join(this.sessionsDir, this.projectHash, `${this.sessionId}.jsonl`);
    exportToJsonl(this.sessionDb, jsonlPath);
  }

  /** Update the session title in memory and index DB */
  public updateSessionTitle(newTitle: string): void {
    this.sessionTitle = newTitle;
    if (this.indexDb) {
      const existing = this.getSessionsForProject().find(s => s.id === this.sessionId);
      const meta: SessionMeta = {
        id: this.sessionId,
        project_path: this.projectRoot,
        project_hash: this.projectHash,
        title: this.sessionTitle,
        created_at: existing?.created_at ?? Date.now(),
        updated_at: Date.now(),
      };
      registerSession(this.indexDb, meta);
    }
  }

  /** Import a JSONL session file */
  public importSessionFromJsonl(jsonlPath: string): ChatMessage[] {
    if (!this.sessionDb) throw new Error('No active session database');
    importFromJsonl(this.sessionDb, jsonlPath);
    return this.getChatMessages();
  }

  /** List all sessions for the current project */
  public getSessionsForProject(): SessionMeta[] {
    if (!this.indexDb) return [];
    return listSessionsForProject(this.indexDb, this.projectHash);
  }

  /** Delete a session completely */
  public deleteSession(sessionId: string): void {
    if (!this.indexDb) return;
    deleteSessionFromIndex(this.indexDb, sessionId);
    const dbPath = path.join(this.sessionsDir, this.projectHash, `${sessionId}.sqlite`);
    const jsonlPath = path.join(this.sessionsDir, this.projectHash, `${sessionId}.jsonl`);
    if (this.sessionDb && this.sessionDb.name === dbPath) {
      this.sessionDb.close();
      this.sessionDb = undefined;
    }
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath);
  }

  // --- Memory Helpers ---

  private getMemoryPath(): string {
    return path.join(this.memoryDir, `${this.projectHash}.json`);
  }

  public getMemoryPrompt(): string {
    return getMemoryAsPrompt(this.getMemoryPath(), this.projectHash);
  }

  public addFact(key: string, value: string, source: 'user' | 'agent' = 'agent'): void {
    addFact(this.getMemoryPath(), this.projectHash, key, value, source);
  }

  public setConvention(key: string, value: string): void {
    setConvention(this.getMemoryPath(), this.projectHash, key, value);
  }

  public loadMemory(): ProjectMemory {
    return loadMemory(this.getMemoryPath(), this.projectHash);
  }

  public saveState(key: string, value: any): void {
    if (!this.sessionDb) return;
    saveState(this.sessionDb, key, value);
  }

  public getState(key: string): any | null {
    if (!this.sessionDb) return null;
    return getState(this.sessionDb, key);
  }

  public saveFailureLesson(lesson: FailureLesson): void {
    if (!this.sessionDb) return;
    saveFailureLesson(this.sessionDb, lesson);
  }

  public getFailureLessons(role?: string): FailureLesson[] {
    if (!this.sessionDb) return [];
    return getFailureLessons(this.sessionDb, role);
  }

  public incrementLessonUsed(lessonId: number): void {
    if (!this.sessionDb) return;
    incrementLessonUsed(this.sessionDb, lessonId);
  }

  public saveProjectStatus(status: ProjectStatus): void {
    if (!this.sessionDb) return;
    saveProjectStatus(this.sessionDb, status);
  }

  public getProjectStatus(): ProjectStatus | null {
    if (!this.sessionDb) return null;
    return getProjectStatus(this.sessionDb);
  }

  /** Close database connections */
  public close(): void {
    if (this.sessionDb) {
      this.sessionDb.close();
      this.sessionDb = undefined;
    }
    if (this.indexDb) {
      this.indexDb.close();
    }
  }
}
