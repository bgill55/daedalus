// Codebase indexing tools — find_symbol, get_definition, get_references, index_codebase
// Uses a shared SQLite FTS5 database via context.indexDb (opened once in main).

import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { initIndexDb, searchSymbols, findDefinitions, findReferences } from '../../indexing/fts.js';
import { indexCodebase } from '../../indexing/indexer.js';
import { ToolContext, ToolResult } from '../../types.js';

// ── Shared DB helpers ──────────────────────────────────────────────────────────

export function getProjectHash(projectRoot: string): string {
  return crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
}

export function getIndexDbPath(projectRoot: string): string {
  const homedir = os.homedir();
  const projectHash = getProjectHash(projectRoot);
  return path.join(homedir, '.daedalus', 'indexing', `${projectHash}.sqlite`);
}

/** Get or create the index DB — uses the shared context.indexDb when available. */
function getDb(context: ToolContext): Database.Database {
  if (context.indexDb) return context.indexDb;
  // Fallback: open a fresh connection (e.g. when called from a sub-agent)
  return initIndexDb(getIndexDbPath(context.projectRoot));
}

// ── Tool implementations ───────────────────────────────────────────────────────

/** Crawl and index the codebase. Respects incremental hashing — only re-indexes changed files. */
export async function index_codebase(
  args: { exclude?: string[]; extensions?: string[] },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const db = getDb(context);
    // Mutate context so subsequent tool calls in this turn use the same open DB
    if (!context.indexDb) context.indexDb = db;

    const projectHash = context.projectHash || getProjectHash(context.projectRoot);

    const result = await indexCodebase(db, context.projectRoot, projectHash, {
      exclude: args.exclude,
      extensions: args.extensions,
    });

    const errNote = result.errors.length > 0
      ? `\n[WARN] ${result.errors.length} file(s) had errors:\n${result.errors.slice(0, 5).map(e => `  • ${e}`).join('\n')}`
      : '';

    return {
      toolCallId: '',
      name: 'index_codebase',
      success: true,
      content:
        `[OK] Indexed ${result.indexedFiles} file(s), skipped ${result.skippedFiles} unchanged ` +
        `(${result.totalFiles} total scanned).${errNote}`,
    };
  } catch (err: any) {
    return {
      toolCallId: '',
      name: 'index_codebase',
      success: false,
      content: '',
      error: `Failed to index codebase: ${err.message}`,
    };
  }
}

/** Fuzzy-search symbols (functions, classes, types, interfaces) using FTS5. */
export async function find_symbol(
  args: { query: string; limit?: number },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const db = getDb(context);
    const projectHash = context.projectHash || getProjectHash(context.projectRoot);
    const limit = args.limit ?? 30;

    const symbols = searchSymbols(db, args.query, projectHash, limit);
    if (symbols.length === 0) {
      return {
        toolCallId: '',
        name: 'find_symbol',
        success: true,
        content:
          `No symbols found matching "${args.query}". ` +
          `Run index_codebase first if you haven't indexed this project yet.`,
      };
    }

    const lines = symbols.map(
      s => `  [${s.kind.padEnd(9)}] ${s.name.padEnd(32)} ${s.file_path}:${s.line_start}–${s.line_end}\n             ${s.signature}`
    );
    return {
      toolCallId: '',
      name: 'find_symbol',
      success: true,
      content: `Found ${symbols.length} symbol(s) matching "${args.query}":\n\n${lines.join('\n\n')}`,
    };
  } catch (err: any) {
    return {
      toolCallId: '',
      name: 'find_symbol',
      success: false,
      content: '',
      error: `Failed to search symbols: ${err.message}`,
    };
  }
}

/** Exact-name lookup — returns file, line range, and signature for a symbol. */
export async function get_definition(
  args: { name: string },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const db = getDb(context);
    const projectHash = context.projectHash || getProjectHash(context.projectRoot);

    const defs = findDefinitions(db, args.name, projectHash);
    if (defs.length === 0) {
      return {
        toolCallId: '',
        name: 'get_definition',
        success: true,
        content:
          `No definition found for "${args.name}". ` +
          `Try find_symbol for a fuzzy search, or run index_codebase to update the index.`,
      };
    }

    const lines = defs.map(
      d =>
        `  [${d.kind}] ${d.name}\n` +
        `  File: ${d.file_path}  lines ${d.line_start}–${d.line_end}\n` +
        `  Signature: ${d.signature}`
    );
    return {
      toolCallId: '',
      name: 'get_definition',
      success: true,
      content: `Definition(s) for "${args.name}":\n\n${lines.join('\n\n')}`,
    };
  } catch (err: any) {
    return {
      toolCallId: '',
      name: 'get_definition',
      success: false,
      content: '',
      error: `Failed to find definitions: ${err.message}`,
    };
  }
}

/** Returns every call-site that references a given symbol name. */
export async function get_references(
  args: { name: string },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const db = getDb(context);
    const projectHash = context.projectHash || getProjectHash(context.projectRoot);

    const refs = findReferences(db, args.name, projectHash);
    if (refs.length === 0) {
      return {
        toolCallId: '',
        name: 'get_references',
        success: true,
        content: `No references found for "${args.name}". The symbol may be unused or not yet indexed.`,
      };
    }

    const lines = refs.map(r => `  • ${r.caller_name.padEnd(28)} ${r.caller_file}:${r.caller_line}`);
    return {
      toolCallId: '',
      name: 'get_references',
      success: true,
      content: `${refs.length} reference(s) to "${args.name}":\n\n${lines.join('\n')}`,
    };
  } catch (err: any) {
    return {
      toolCallId: '',
      name: 'get_references',
      success: false,
      content: '',
      error: `Failed to find references: ${err.message}`,
    };
  }
}