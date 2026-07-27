import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getTurns, saveTurn } from './sqlite.js';
import { applyCodeDiffs } from './gitMerger.js';

export interface SessionBranch {
  id: string;
  name: string;
  parent_id: string | null;
  branch_point_step: number;
  status: 'active' | 'archived' | 'merged';
  created_at: number;
  workspace_root: string;
}

export function initBranchingDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      branch_point_step INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      workspace_root TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_branches_parent ON session_branches(parent_id);
  `);
}

export function createSessionBranch(
  db: Database.Database,
  parentId: string,
  branchName: string,
  workspaceRoot: string,
  sessionDir: string
): SessionBranch {
  initBranchingDatabase(db);

  const existing = db
    .prepare('SELECT * FROM session_branches WHERE name = ?')
    .get(branchName) as SessionBranch | undefined;

  if (existing) {
    throw new Error(`Session branch with name '${branchName}' already exists.`);
  }

  const currentTurns = getTurns(db);
  const branchPointStep = currentTurns.length;
  const newId = crypto.randomUUID();
  const createdAt = Date.now();

  const stmt = db.prepare(`
    INSERT INTO session_branches (id, name, parent_id, branch_point_step, status, created_at, workspace_root)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `);
  stmt.run(newId, branchName, parentId, branchPointStep, createdAt, workspaceRoot);

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const jsonlPath = path.join(sessionDir, `${newId}.jsonl`);
  const lines = currentTurns.map((t, i) =>
    JSON.stringify({
      step: i + 1,
      role: t.role,
      content: t.content,
      tool_calls: t.tool_calls ? JSON.parse(t.tool_calls) : undefined,
      timestamp: t.created_at || createdAt,
    }) + '\n'
  );
  fs.writeFileSync(jsonlPath, lines.join(''), 'utf8');

  return {
    id: newId,
    name: branchName,
    parent_id: parentId,
    branch_point_step: branchPointStep,
    status: 'active',
    created_at: createdAt,
    workspace_root: workspaceRoot,
  };
}

export function checkoutSessionBranch(
  db: Database.Database,
  nameOrId: string
): SessionBranch {
  initBranchingDatabase(db);
  const branch = db
    .prepare('SELECT * FROM session_branches WHERE id = ? OR name = ?')
    .get(nameOrId, nameOrId) as SessionBranch | undefined;

  if (!branch) {
    throw new Error(`Session branch '${nameOrId}' not found.`);
  }
  return branch;
}

export function listSessionBranches(db: Database.Database): string {
  initBranchingDatabase(db);
  const branches = db
    .prepare('SELECT * FROM session_branches ORDER BY created_at ASC')
    .all() as SessionBranch[];

  if (branches.length === 0) {
    return 'No session branches found.';
  }

  const allBranchIds = new Set(branches.map((b) => b.id));
  const rootBranches = branches.filter((b) => !b.parent_id || !allBranchIds.has(b.parent_id));
  const childMap = new Map<string, SessionBranch[]>();

  for (const b of branches) {
    if (b.parent_id) {
      const list = childMap.get(b.parent_id) || [];
      list.push(b);
      childMap.set(b.parent_id, list);
    }
  }

  const lines: string[] = [];

  function renderBranch(b: SessionBranch, prefix: string, isLast: boolean): void {
    const connector = isLast ? '└── ' : '├── ';
    const indent = prefix;
    lines.push(`${indent}${connector}${b.name} (${b.status}) [id: ${b.id.slice(0, 8)}]`);
    const children = childMap.get(b.id) || [];
    const nextPrefix = indent + (isLast ? '    ' : '│   ');
    children.forEach((child, index) => {
      renderBranch(child, nextPrefix, index === children.length - 1);
    });
  }

  rootBranches.forEach((root) => {
    lines.push(`* ${root.name} (${root.status}) [id: ${root.id.slice(0, 8)}]`);
    const children = childMap.get(root.id) || [];
    children.forEach((child, cIndex) => {
      renderBranch(child, '  ', cIndex === children.length - 1);
    });
  });

  return lines.join('\n');
}

export async function mergeSessionBranch(
  db: Database.Database,
  targetNameOrId: string,
  workspaceRoot: string,
  sessionDir: string
): Promise<{ success: boolean; message: string }> {
  initBranchingDatabase(db);
  const target = db
    .prepare('SELECT * FROM session_branches WHERE id = ? OR name = ?')
    .get(targetNameOrId, targetNameOrId) as SessionBranch | undefined;

  if (!target) {
    throw new Error(`Target branch '${targetNameOrId}' not found.`);
  }

  if (target.status === 'merged') {
    return { success: false, message: `Branch '${target.name}' is already merged.` };
  }

  const jsonlPath = path.join(sessionDir, `${target.id}.jsonl`);
  const diffs: string[] = [];
  const newTurnsToAppend: Array<{ role: string; content: string; tool_calls?: unknown }> = [];
  const parseErrors: string[] = [];

  if (fs.existsSync(jsonlPath)) {
    const raw = fs.readFileSync(jsonlPath, 'utf8');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

    for (let i = target.branch_point_step; i < lines.length; i++) {
      try {
        const item = JSON.parse(lines[i]);
        if (item.role && item.content) {
          if (item.code_diff) {
            diffs.push(item.code_diff);
          }
          newTurnsToAppend.push({
            role: item.role,
            content: item.content,
            tool_calls: item.tool_calls,
          });
        }
      } catch (err) {
        parseErrors.push(`Line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (parseErrors.length > 0) {
    return { success: false, message: `Failed to parse ${parseErrors.length} turn(s) in branch JSONL: ${parseErrors.join('; ')}` };
  }

  if (diffs.length > 0) {
    const patchResult = await applyCodeDiffs(diffs, workspaceRoot);
    if (!patchResult.success) {
      return { success: false, message: patchResult.error || 'Failed to apply branch patch diffs.' };
    }
  }

  for (const t of newTurnsToAppend) {
    saveTurn(db, {
      role: t.role,
      content: t.content,
      tool_calls: t.tool_calls ? JSON.stringify(t.tool_calls) : undefined,
    });
  }

  db.prepare("UPDATE session_branches SET status = 'merged' WHERE id = ?").run(target.id);

  return {
    success: true,
    message: `Merged '${target.name}' successfully into current session (${newTurnsToAppend.length} turns appended).`,
  };
}
