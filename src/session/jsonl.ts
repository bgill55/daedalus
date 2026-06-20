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

export function exportToJsonl(db: Database.Database, jsonlPath: string): void {
  const turns = getTurns(db);
  const lines: string[] = [];

  turns.forEach((t, index) => {
    let toolCallsParsed: any[] | undefined = undefined;
    if (t.tool_calls) {
      try {
        toolCallsParsed = JSON.parse(t.tool_calls);
      } catch {
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

    lines.push(JSON.stringify(line) + '\n');
  });

  fs.writeFileSync(jsonlPath, lines.join(''), 'utf8');
}

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
