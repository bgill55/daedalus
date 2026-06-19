import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { ToolContext, ToolResult } from '../../types.js';

function formatError(error: string): ToolResult {
  return { toolCallId: '', name: '', success: false, content: '', error };
}

let serviceHost: ts.LanguageServiceHost | null = null;
let languageService: ts.LanguageService | null = null;
let serviceRoot: string | null = null;

function initService(projectRoot: string): ts.LanguageService {
  if (languageService && serviceRoot === projectRoot) return languageService;

  const tsconfigPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  const config = tsconfigPath
    ? ts.readConfigFile(tsconfigPath, ts.sys.readFile)
    : { config: {} };
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot);

  const files = new Map<string, { version: number; content: string }>();

  const getOrLoad = (fp: string): string => {
    if (!files.has(fp)) files.set(fp, { version: 0, content: ts.sys.readFile(fp) ?? '' });
    return files.get(fp)!.content;
  };

  serviceHost = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: fp => String(files.get(fp)?.version ?? 0),
    getScriptSnapshot: fp => {
      const content = getOrLoad(fp);
      return ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => projectRoot,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  languageService = ts.createLanguageService(serviceHost, ts.createDocumentRegistry());
  serviceRoot = projectRoot;
  return languageService;
}

function resolveAbsPath(p: string, projectRoot: string): string {
  return path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
}

export async function lspDiagnostics(
  args: { path?: string },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const svc = initService(context.projectRoot);
    let files: string[];
    if (args.path) {
      files = [resolveAbsPath(args.path, context.projectRoot)];
    } else {
      files = serviceHost!.getScriptFileNames().filter(f => !f.includes('node_modules'));
    }

    const results: string[] = [];
    for (const file of files) {
      const diags = [
        ...svc.getSemanticDiagnostics(file),
        ...svc.getSyntacticDiagnostics(file),
      ];
      if (diags.length === 0) continue;
      const rel = path.relative(context.projectRoot, file);
      for (const d of diags) {
        const pos = d.file && d.start !== undefined
          ? ts.getLineAndCharacterOfPosition(d.file, d.start)
          : null;
        const loc = pos ? `${rel}:${pos.line + 1}:${pos.character + 1}` : rel;
        const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        results.push(`${loc}: ${msg}`);
      }
    }

    if (results.length === 0) {
      return { toolCallId: '', name: 'lsp_diagnostics', success: true, content: 'No type errors found.' };
    }
    return { toolCallId: '', name: 'lsp_diagnostics', success: true, content: results.join('\n') };
  } catch (err: any) {
    return formatError(`lsp_diagnostics failed: ${err.message}`);
  }
}

export async function lspHover(
  args: { path: string; line: number; col: number },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const svc = initService(context.projectRoot);
    const filePath = resolveAbsPath(args.path, context.projectRoot);
    const src = fs.readFileSync(filePath, 'utf8');
    const lines = src.split('\n');
    const offset = lines.slice(0, args.line - 1).join('\n').length + (args.line > 1 ? 1 : 0) + (args.col - 1);

    const info = svc.getQuickInfoAtPosition(filePath, offset);
    if (!info) return formatError(`No type info at ${args.path}:${args.line}:${args.col}`);

    const typeStr = ts.displayPartsToString(info.displayParts);
    const docStr = ts.displayPartsToString(info.documentation ?? []);
    const content = docStr ? `${typeStr}\n\n${docStr}` : typeStr;
    return { toolCallId: '', name: 'lsp_hover', success: true, content };
  } catch (err: any) {
    return formatError(`lsp_hover failed: ${err.message}`);
  }
}

export async function lspRename(
  args: { path: string; line: number; col: number; new_name: string },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const svc = initService(context.projectRoot);
    const filePath = resolveAbsPath(args.path, context.projectRoot);
    const src = fs.readFileSync(filePath, 'utf8');
    const lines = src.split('\n');
    const offset = lines.slice(0, args.line - 1).join('\n').length + (args.line > 1 ? 1 : 0) + (args.col - 1);

    const renameInfo = svc.getRenameInfo(filePath, offset, { allowRenameOfImportPath: false });
    if (!renameInfo.canRename) {
      return formatError(`Cannot rename: ${renameInfo.localizedErrorMessage ?? 'not a renameable symbol'}`);
    }

    const locations = svc.findRenameLocations(filePath, offset, false, false, false);
    if (!locations || locations.length === 0) return formatError('No rename locations found.');

    const byFile = new Map<string, ts.RenameLocation[]>();
    for (const loc of locations) {
      const arr = byFile.get(loc.fileName) ?? [];
      arr.push(loc);
      byFile.set(loc.fileName, arr);
    }

    const changed: string[] = [];
    for (const [file, locs] of byFile) {
      let content = fs.readFileSync(file, 'utf8');
      const sorted = [...locs].sort((a, b) => b.textSpan.start - a.textSpan.start);
      for (const loc of sorted) {
        content = content.slice(0, loc.textSpan.start) + args.new_name + content.slice(loc.textSpan.start + loc.textSpan.length);
      }
      fs.writeFileSync(file, content, 'utf8');
      changed.push(`${path.relative(context.projectRoot, file)} (${locs.length} occurrence${locs.length > 1 ? 's' : ''})`);
    }

    languageService = null;

    return {
      toolCallId: '', name: 'lsp_rename', success: true,
      content: `Renamed '${renameInfo.displayName}' to '${args.new_name}' in ${changed.length} file(s):\n${changed.join('\n')}`,
    };
  } catch (err: any) {
    return formatError(`lsp_rename failed: ${err.message}`);
  }
}
