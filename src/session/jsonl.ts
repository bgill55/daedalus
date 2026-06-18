// JSONL import/export for session portability

import fs from 'fs';
import Database from 'better-sqlite3';
import { getTurns, clearTurns, saveTurn, SqliteTurn } from './sqlite.js';

export interface JsonlTurn {
  turn: number;
  role: string;
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  model?: string;
  tokens?: {
    in?: number;
    out?: number;
  };
  timestamp?: number;
}

/** Export all turns from a session SQLite DB to a JSONL file */
export function exportToJsonl(db: Database.Database, jsonlPath: string): void {
  const turns = getTurns(db);
  const stream = fs.createWriteStream(jsonlPath, { encoding: 'utf8' });

  turns.forEach((t, index) => {
    let toolCallsParsed: any[] | undefined = undefined;
    if (t.tool_calls) {
      try {
        toolCallsParsed = JSON.parse(t.tool_calls);
      } catch {
        // Ignored
      }
    }

    const tokens = (t.tokens_input || t.tokens_output) ? {
      in: t.tokens_input || undefined,
      out: t.tokens_output || undefined,
    } : undefined;

    const line: JsonlTurn = {
      turn: index + 1,
      role: t.role,
      content: t.content,
      tool_calls: toolCallsParsed,
      tool_call_id: t.tool_call_id || undefined,
      name: t.name || undefined,
      model: t.model || undefined,
      tokens,
      timestamp: t.created_at,
    };

    stream.write(JSON.stringify(line) + '\n');
  });

  stream.end();
}

/** Import turns from a JSONL file into a session SQLite DB */
export function importFromJsonl(db: Database.Database, jsonlPath: string): void {
  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`JSONL file not found: ${jsonlPath}`);
  }

  const content = fs.readFileSync(jsonlPath, 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

  clearTurns(db);

  for (const line of lines) {
    const parsed = JSON.parse(line) as JsonlTurn;
    const turn: SqliteTurn = {
      role: parsed.role,
      content: parsed.content,
      tool_calls: parsed.tool_calls ? JSON.stringify(parsed.tool_calls) : undefined,
      tool_call_id: parsed.tool_call_id,
      name: parsed.name,
      model: parsed.model,
      tokens_input: parsed.tokens?.in,
      tokens_output: parsed.tokens?.out,
      created_at: parsed.timestamp,
    };
    saveTurn(db, turn);
  }
}
