import { spawnSync } from 'child_process';
import ts from 'typescript';
import { ToolContext, ToolResult } from '../../types.js';

function formatError(error: string): ToolResult {
  return { toolCallId: '', name: 'eval_code', success: false, content: '', error };
}

async function promptApproval(code: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`\n[EVAL] About to execute:\n${'-'.repeat(50)}\n${code.slice(0, 500)}\n${'-'.repeat(50)}\nProceed? [y/n]: `);
  return new Promise(resolve => {
    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
    const onKey = (key: Buffer) => {
      const ch = key.toString().toLowerCase();
      if (ch === 'y') { cleanup(); process.stdout.write('Y\n'); resolve(true); }
      else if (ch === 'n' || ch === '\u0003') { cleanup(); process.stdout.write('N\n'); resolve(false); }
    };
    process.stdin.on('data', onKey);
    const cleanup = () => {
      process.stdin.off('data', onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
    };
  });
}

export async function evalCode(
  args: { code: string; lang?: string; timeout?: number },
  context: ToolContext
): Promise<ToolResult> {
  const approved = await promptApproval(args.code);
  if (!approved) {
    return { toolCallId: '', name: 'eval_code', success: false, content: '', error: 'Eval cancelled by user.' };
  }

  try {
    const lang = args.lang ?? 'ts';
    const timeoutMs = (args.timeout ?? 10) * 1000;

    let jsCode = args.code;

    if (lang === 'ts' || lang === 'typescript') {
      const result = ts.transpileModule(args.code, {
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      });
      if (result.diagnostics && result.diagnostics.length > 0) {
        const errors = result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
        return formatError(`TypeScript transpile errors:\n${errors}`);
      }
      jsCode = result.outputText;
    }

    const wrappedCode = `
const __result = (async () => {
${jsCode}
})();
__result.then(v => { if (v !== undefined) process.stdout.write(String(v) + '\\n'); }).catch(e => { process.stderr.write(e.message + '\\n'); process.exit(1); });
`;

    const proc = spawnSync(process.execPath, ['--input-type=commonjs'], {
      input: wrappedCode,
      cwd: context.projectRoot,
      timeout: timeoutMs,
      encoding: 'utf8',
      env: { ...process.env },
    });

    const stdout = (proc.stdout ?? '').trim();
    const stderr = (proc.stderr ?? '').trim();

    if (proc.signal === 'SIGTERM' || proc.error?.message?.includes('ETIMEDOUT')) {
      return formatError(`eval_code timed out after ${args.timeout ?? 10}s`);
    }

    const parts: string[] = [];
    if (stdout) parts.push(`stdout:\n${stdout}`);
    if (stderr) parts.push(`stderr:\n${stderr}`);
    if (parts.length === 0) parts.push('(no output)');

    return {
      toolCallId: '', name: 'eval_code',
      success: proc.status === 0,
      content: parts.join('\n\n'),
    };
  } catch (err: any) {
    return formatError(`eval_code failed: ${err.message}`);
  }
}
