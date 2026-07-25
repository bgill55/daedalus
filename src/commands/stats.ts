import pc from 'picocolors';
import { globalSessionStats } from '../session/analytics.js';

/** Format and return session statistics report for CLI display */
export function handleStatsCommand(): string {
  const report = globalSessionStats.getReport();
  const width = Math.min(process.stdout.columns || 80, 72);
  const ruleLen = Math.max(10, width - 34);

  const lines = [
    `  ${pc.bold(pc.cyan('─ Session & System Statistics ─'))} ${pc.dim('─'.repeat(ruleLen))}`,
    `  ${pc.gray('Uptime:')}            ${pc.bold(report.uptime)}`,
    `  ${pc.gray('Interactions:')}      ${pc.bold(report.totalInteractions.toString())}`,
    `  ${pc.gray('Total Tokens:')}      ${pc.bold(pc.cyan(report.totalTokens.toLocaleString()))}`,
    `  ${pc.gray('Prompt Tokens:')}     ${pc.bold(report.promptTokens.toLocaleString())}`,
    `  ${pc.gray('Completion:')}        ${pc.bold(report.completionTokens.toLocaleString())}`,
    `  ${pc.gray('Error Count:')}       ${report.totalErrors > 0 ? pc.bold(pc.red(report.totalErrors.toString())) : pc.bold(pc.green('0'))}`,
    `  ${pc.dim('─'.repeat(width - 4))}`,
  ];

  return lines.join('\n');
}