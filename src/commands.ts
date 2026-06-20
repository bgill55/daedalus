import path from 'path';
import os from 'os';
import pc from 'picocolors';
import { executeToolCalls } from './tools/executor.js';
import { discoverLocalServers } from './config/index.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import type { LocalRouter } from './router/index.js';

export interface CommandDeps {
  router: LocalRouter;
  config: any;
  configDir: string;
  toolContext: ToolContext;
  activeFiles: Map<string, string>;
  messages: ChatMessage[];
  projectHash: string;
}

function getIndexDbPath(projectHash: string): string {
  return path.join(os.homedir(), '.daedalus', 'indexing', `${projectHash}.sqlite`);
}

export function createCommandHandlers(deps: CommandDeps) {
  const { router, config, configDir, toolContext, activeFiles, messages, projectHash } = deps;

  async function handleSpawn(role: string, task: string): Promise<void> {
    const validRoles = ['coder', 'reviewer', 'debugger', 'researcher', 'planner'];
    if (!validRoles.includes(role)) {
      console.log(pc.red(`[WARN] Unknown role: ${role}. Valid: ${validRoles.join(', ')}`));
      return;
    }

    console.log(pc.cyan(`\n[SPAWN] Spawning ${role} agent for: ${task.slice(0, 80)}...`));

    const context = `Active files: ${Array.from(activeFiles.values()).join(', ') || 'none'}`;

    const fakeToolCall: ToolCall = {
      id: `call_${Date.now()}`,
      type: 'function',
      function: {
        name: 'delegate_task',
        arguments: JSON.stringify({ goal: task, context, role }),
      },
    };

    const results = await executeToolCalls([fakeToolCall], toolContext);
    
    for (const result of results) {
      const status = result.success ? pc.green('✔') : pc.red('✗');
      console.log(`\n${status} ${role} agent completed`);
      console.log(pc.white(result.content));
      if (!result.success && result.error) {
        console.log(pc.red(`Error: ${result.error}`));
      }
    }
  }

  async function handleOrchestrate(goal: string): Promise<void> {
    console.log(pc.cyan(`\n[ORCHESTRATE] Starting orchestration for: ${goal}`));
    
    const { Orchestrator } = await import('./agents/orchestrator.js');
    const orchestrator = new Orchestrator(router, messages, toolContext);
    
    const result = await orchestrator.run(goal);
    console.log(pc.white(`\n${result}`));
  }

  async function handleModels(): Promise<void> {
    console.log(pc.bold('\n--- Available Models ---'));
    
    const models = await router.listModels();
    if (models.length === 0) {
      console.log(pc.yellow('  No models found. Check your local servers (LM Studio, Ollama, etc.)'));
    } else {
      for (const model of models) {
        console.log(`  • ${pc.cyan(model)}`);
      }
    }
    
    const { checkModelHealth } = await import('./router/health.js');
    const healthyModels = router.getHealthyModels();
    console.log(pc.bold('\n--- Healthy Models ---'));
    for (const model of healthyModels) {
      const health = await checkModelHealth(model, 5000);
      const status = health?.healthy ? pc.green('●') : pc.red('●');
      console.log(`  ${status} ${pc.cyan(model.name)} (${model.endpoint}) - ${model.model}`);
    }
    console.log(pc.bold('----------------------\n'));
  }

  function handleConfig(): void {
    console.log(pc.bold('\n--- Current Configuration ---'));
    console.log(JSON.stringify(config, null, 2));
    console.log(pc.bold('-----------------------------'));
    console.log(pc.gray(`\nEdit ${configDir}/config.json to modify settings.`));
    console.log(pc.gray('Run `daedalus /doctor` to auto-discover local servers.'));
  }

  async function handleDoctor(): Promise<void> {
    console.log(pc.bold('\n--- Daedalus Doctor ---'));
    console.log(pc.gray('Checking local server connections...\n'));
    
    const discovered = await discoverLocalServers();
    
    if (discovered.length === 0) {
      console.log(pc.yellow('  No local servers detected.'));
      console.log(pc.gray('  Start one of:'));
      console.log(pc.gray('    • LM Studio (http://localhost:1234)'));
      console.log(pc.gray('    • Ollama (http://localhost:11434)'));
      console.log(pc.gray('    • llama.cpp server (--server, default :8080)'));
      console.log(pc.gray('    • vLLM (http://localhost:8000)'));
    } else {
      console.log(pc.green(`  Found ${discovered.length} running server(s):\n`));
      for (const server of discovered) {
        console.log(`  ${pc.green('●')} ${server.name} at ${server.endpoint}`);
        for (const model of server.models.slice(0, 5)) {
          console.log(`      - ${model}`);
        }
        if (server.models.length > 5) {
          console.log(pc.gray(`      ... and ${server.models.length - 5} more`));
        }
      }
    }
    
    console.log(pc.bold('\n--- Router Health ---'));
    const enabledModels = router.getEnabledModels();
    if (enabledModels.length === 0) {
      console.log(pc.yellow('  No models configured. Run /onboard to set one up.'));
    } else {
      for (const model of enabledModels) {
        const { checkModelHealth } = await import('./router/health.js');
        const health = await checkModelHealth(model, 5000);
        const status = health.healthy ? pc.green('●') : pc.red('●');
        const latency = health.latencyMs ? ` (${health.latencyMs}ms)` : '';
        const err = health.error ? ` ${pc.red(health.error)}` : '';
        console.log(`  ${status} ${model.name}: ${model.endpoint}${latency}${err}`);
      }
    }
    console.log(pc.bold('  Config:') + pc.gray(` ${configDir}\\config.json`));
    console.log(pc.bold('----------------------\n'));
  }

  async function handleIndex(opts: { exclude?: string[]; extensions?: string[] }): Promise<void> {
    console.log(pc.bold('\n--- Indexing Codebase ---'));
    console.log(pc.gray(`Project: ${process.cwd()}`));

    const indexDbPath = getIndexDbPath(projectHash);

    if (!fs.existsSync(path.dirname(indexDbPath))) {
      fs.mkdirSync(path.dirname(indexDbPath), { recursive: true });
    }

    const { initIndexDb } = await import('./indexing/fts.js');
    const { indexCodebase } = await import('./indexing/indexer.js');

    const db = initIndexDb(indexDbPath);

    console.log(pc.gray('\nScanning files...'));
    const start = Date.now();

    try {
      const barWidth = 20;
      let lastPct = -1;
      const onProgress = ({ current, total, file }: { current: number; total: number; file: string }) => {
        const pct = Math.round((current / total) * 100);
        if (pct === lastPct) return;
        lastPct = pct;
        const filled = Math.round((current / total) * barWidth);
        const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
        process.stdout.write(`\r  ${pc.cyan(bar)} ${pc.white(`${current}/${total}`)} ${pc.gray(file.slice(-40))}`);
      };

      const result = await indexCodebase(db, process.cwd(), projectHash, { ...opts, onProgress });
      process.stdout.write('\n');
      const elapsed = Date.now() - start;

      toolContext.indexDb = db;

      console.log(pc.green(`\n✔ Indexing complete in ${elapsed}ms`));
      console.log(pc.white(`  Total files:     ${result.totalFiles}`));
      console.log(pc.white(`  Indexed files:   ${result.indexedFiles}`));
      console.log(pc.white(`  Skipped (unchanged): ${result.skippedFiles}`));
      if (result.errors.length > 0) {
        console.log(pc.yellow(`\nErrors (${result.errors.length}):`));
        result.errors.slice(0, 10).forEach(e => console.log(pc.red(`  - ${e}`)));
        if (result.errors.length > 10) {
          console.log(pc.gray(`  ... and ${result.errors.length - 10} more`));
        }
      }
    } catch (err: any) {
      console.error(pc.red(`\n[ERROR] Indexing failed: ${err.message}`));
    }
  }

  async function handleFindSymbol(query: string, limit: number): Promise<void> {
    const indexDbPath = getIndexDbPath(projectHash);

    if (!fs.existsSync(indexDbPath)) {
      console.log(pc.yellow('[WARN] No index found. Run /index first.'));
      return;
    }
    
    const { initIndexDb, searchSymbols } = await import('./indexing/fts.js');
    const db = initIndexDb(indexDbPath);

    console.log(pc.bold(`\n--- Symbol Search: "${query}" ---`));
    const symbols = searchSymbols(db, query, projectHash, limit);

    if (symbols.length === 0) {
      console.log(pc.gray('  No symbols found.'));
      return;
    }

    console.log(pc.white(`\nFound ${symbols.length} symbol(s):`));
    for (const s of symbols) {
      const kindColor = s.kind === 'function' ? pc.cyan : s.kind === 'class' ? pc.green : s.kind === 'interface' ? pc.blue : pc.white;
      const loc = `${s.file_path}:${s.line_start}${s.line_end !== s.line_start ? '-' + s.line_end : ''}`;
      console.log(`  ${kindColor(`[${s.kind}]`)} ${pc.bold(s.name)} ${pc.dim(`(${loc})`)}`);
      if (s.signature) {
        console.log(pc.dim(`    ${s.signature.slice(0, 100)}${s.signature.length > 100 ? '...' : ''}`));
      }
    }
  }

  async function handleGetReferences(symbol: string): Promise<void> {
    const indexDbPath = getIndexDbPath(projectHash);

    if (!fs.existsSync(indexDbPath)) {
      console.log(pc.yellow('[WARN] No index found. Run /index first.'));
      return;
    }

    const { initIndexDb, findReferences } = await import('./indexing/fts.js');
    const db = initIndexDb(indexDbPath);

    console.log(pc.bold(`\n--- References to: ${symbol} ---`));
    const refs = findReferences(db, symbol, projectHash);

    if (refs.length === 0) {
      console.log(pc.gray('  No references found.'));
      return;
    }

    const byCaller = new Map<string, typeof refs>();
    for (const r of refs) {
      const key = `${r.caller_name} (${r.caller_file}:${r.caller_line})`;
      if (!byCaller.has(key)) byCaller.set(key, []);
      byCaller.get(key)!.push(r);
    }

    console.log(pc.white(`\nFound ${refs.length} reference(s) from ${byCaller.size} caller(s):`));
    for (const [caller, refs] of byCaller) {
      console.log(pc.cyan(`\n  ${caller}:`));
      for (const r of refs.slice(0, 5)) {
        console.log(pc.dim(`    ${r.callee_name} at ${r.callee_file}:${r.callee_line}`));
      }
      if (refs.length > 5) {
        console.log(pc.dim(`    ... and ${refs.length - 5} more`));
      }
    }
  }

  async function handleGetDefinition(symbol: string): Promise<void> {
    const indexDbPath = getIndexDbPath(projectHash);

    if (!fs.existsSync(indexDbPath)) {
      console.log(pc.yellow('[WARN] No index found. Run /index first.'));
      return;
    }

    const { initIndexDb, findDefinitions } = await import('./indexing/fts.js');
    const db = initIndexDb(indexDbPath);

    console.log(pc.bold(`\n--- Definition: ${symbol} ---`));
    const defs = findDefinitions(db, symbol, projectHash);

    if (defs.length === 0) {
      console.log(pc.gray('  No definitions found.'));
      return;
    }

    console.log(pc.white(`\nFound ${defs.length} definition(s):`));
    for (const d of defs) {
      const kindColor = d.kind === 'function' ? pc.cyan : d.kind === 'class' ? pc.green : d.kind === 'interface' ? pc.blue : pc.white;
      const loc = `${d.file_path}:${d.line_start}${d.line_end !== d.line_start ? '-' + d.line_end : ''}`;
      console.log(`  ${kindColor(`[${d.kind}]`)} ${pc.bold(d.name)} ${pc.dim(`(${loc})`)}`);
      if (d.signature) {
        console.log(pc.dim(`    ${d.signature.slice(0, 120)}${d.signature.length > 120 ? '...' : ''}`));
      }
    }
  }

  return {
    handleSpawn,
    handleOrchestrate,
    handleModels,
    handleConfig,
    handleDoctor,
    handleIndex,
    handleFindSymbol,
    handleGetReferences,
    handleGetDefinition,
    getIndexDbPath: () => getIndexDbPath(projectHash),
  };
}
