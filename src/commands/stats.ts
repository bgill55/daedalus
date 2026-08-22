import pc from 'picocolors';
import { globalSessionStats } from '../session/analytics.js';
import { initIndexDb, getIndexedFileCount } from '../indexing/fts.js';
import { brand } from '../ui/theme.js';
import type { CommandContext } from './types.js';

/** Format and return session statistics report for CLI display */
export function handleStatsCommand(ctx?: CommandContext): string {
  const report = globalSessionStats.getReport();
  const width = Math.min(process.stdout.columns || 80, 78);
  const ruleLen = Math.max(8, width - 30);

  const avgPerTurn = report.totalInteractions > 0
    ? Math.round(report.totalTokens / report.totalInteractions).toLocaleString()
    : '0';

  let indexed = 0;
  if (ctx) {
    try {
      const db = initIndexDb(ctx.getIndexDbPath());
      indexed = getIndexedFileCount(db, ctx.projectHash);
    } catch {
      indexed = 0;
    }
  }

  const lastModel = report.lastModel
    ? (report.lastTier ? `${report.lastModel} ${pc.dim(`(${report.lastTier})`)}` : report.lastModel)
    : pc.dim('none yet');

  const sessionId = ctx?.sessionManager?.sessionId ?? pc.dim('n/a');

  const lines = [
    `  ${pc.bold(brand('─ Session & System Statistics ─'))} ${pc.dim('─'.repeat(ruleLen))}`,
    `  ${pc.gray('Uptime:')}            ${pc.bold(report.uptime)}`,
    `  ${pc.gray('Session ID:')}        ${pc.bold(sessionId)}`,
    `  ${pc.gray('Interactions:')}      ${pc.bold(report.totalInteractions.toString())}`,
    `  ${pc.gray('Tool Calls:')}        ${pc.bold(report.toolCalls?.toString() ?? '0')}`,
    `  ${pc.gray('Avg Tokens/Turn:')}   ${pc.bold(avgPerTurn)}`,
    `  ${pc.gray('Total Tokens:')}      ${pc.bold(pc.cyan(report.totalTokens.toLocaleString()))}`,
    `  ${pc.gray('  Prompt:')}          ${pc.bold(report.promptTokens.toLocaleString())}`,
    `  ${pc.gray('  Completion:')}      ${pc.bold(report.completionTokens.toLocaleString())}`,
    `  ${pc.gray('Errors:')}            ${report.totalErrors > 0 ? pc.bold(pc.red(report.totalErrors.toString())) : pc.bold(pc.green('0'))}`,
    `  ${pc.gray('Indexed Files:')}     ${pc.bold(indexed.toString())}`,
    `  ${pc.gray('Last Model:')}        ${lastModel}`,
    `  ${pc.dim('─'.repeat(width - 4))}`,
  ];

  return lines.join('\n');
}
