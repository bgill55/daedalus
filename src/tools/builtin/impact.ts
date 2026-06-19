import fs from 'fs';
import path from 'path';
import { ToolContext, ToolResult } from '../../types.js';

function formatError(error: string): ToolResult {
  return { toolCallId: '', name: 'get_impact', success: false, content: '', error };
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function walkSourceFiles(dir: string, exclude: string[] = []): string[] {
  const results: string[] = [];
  const walk = (d: string, depth = 0) => {
    if (depth > 10) return;
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', 'dist', '.git', '.next', 'build', ...exclude].includes(entry.name)) continue;
          walk(full, depth + 1);
        } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
          results.push(full);
        }
      }
    } catch {}
  };
  walk(dir);
  return results;
}

function buildImportGraph(files: string[], projectRoot: string): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const importRe = /from\s+['"]([^'"]+)['"]/g;
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const importsFrom = new Set<string>();

    for (const re of [importRe, requireRe]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        const spec = m[1];
        if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
        const candidates = [
          spec,
          `${spec}.ts`, `${spec}.tsx`, `${spec}.js`,
          `${spec}/index.ts`, `${spec}/index.js`,
        ];
        for (const c of candidates) {
          const resolved = path.resolve(path.dirname(file), c);
          if (files.includes(resolved)) {
            importsFrom.add(resolved);
            break;
          }
        }
      }
    }

    graph.set(file, importsFrom);
  }
  return graph;
}

function buildReverseGraph(graph: Map<string, Set<string>>): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();
  for (const [importer, deps] of graph) {
    for (const dep of deps) {
      const s = reverse.get(dep) ?? new Set();
      s.add(importer);
      reverse.set(dep, s);
    }
  }
  return reverse;
}

function bfsImpact(target: string, reverseGraph: Map<string, Set<string>>): Map<number, string[]> {
  const visited = new Set<string>();
  const byDepth = new Map<number, string[]>();
  const queue: [string, number][] = [[target, 0]];

  while (queue.length > 0) {
    const [node, depth] = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (depth > 0) {
      const arr = byDepth.get(depth) ?? [];
      arr.push(node);
      byDepth.set(depth, arr);
    }
    for (const importer of reverseGraph.get(node) ?? []) {
      if (!visited.has(importer)) queue.push([importer, depth + 1]);
    }
  }
  return byDepth;
}

export async function getImpact(
  args: { target: string },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const files = walkSourceFiles(context.projectRoot);
    if (files.length === 0) return formatError('No source files found in project.');

    const graph = buildImportGraph(files, context.projectRoot);
    const reverseGraph = buildReverseGraph(graph);

    const targetAbs = path.isAbsolute(args.target)
      ? args.target
      : path.resolve(context.projectRoot, args.target);

    const byDepth = bfsImpact(targetAbs, reverseGraph);

    if (byDepth.size === 0) {
      return {
        toolCallId: '', name: 'get_impact', success: true,
        content: `No files import '${args.target}'. Safe to modify without downstream impact.`,
      };
    }

    const lines: string[] = [`Impact analysis for: ${path.relative(context.projectRoot, targetAbs)}\n`];
    const totalAffected = [...byDepth.values()].reduce((n, arr) => n + arr.length, 0);
    lines.push(`${totalAffected} file(s) affected across ${byDepth.size} import depth(s).\n`);

    for (const [depth, impacted] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`Depth ${depth} (${depth === 1 ? 'direct importers' : 'transitive'}):`);
      for (const f of impacted) {
        lines.push(`  ${path.relative(context.projectRoot, f)}`);
      }
    }

    if (totalAffected > 5) {
      lines.push(`\n[WARN] Large blast radius — consider lsp_diagnostics after making changes.`);
    }

    return { toolCallId: '', name: 'get_impact', success: true, content: lines.join('\n') };
  } catch (err: any) {
    return formatError(`get_impact failed: ${err.message}`);
  }
}
