import pc from 'picocolors';
import { globalSessionStats } from '../session/analytics.js';

export function handleStatsCommand(): string {
  const report = globalSessionStats.getReport();

  const lines = [
    pc.bold(pc.cyan('┌─ Session & System Statistics ─────────────────────────────┐')),
    `│ ${pc.bold('Uptime:')}          ${report.uptime} │`,
    `│ ${pc.bold('Interactions:')}    ${report.totalInteractions} │`,
    `│ ${pc.bold('Total Tokens:')}    ${report.totalTokens} │`,
    `│ ${pc.bold('Prompt Tokens:')}   ${report.promptTokens} │`,
    `│ ${pc.bold('Completion Tokens:')} ${report.completionTokens} │`,
    `│ ${pc.bold('Error Count:')}     ${report.totalErrors} │`,
    pc.bold(pc.cyan('└─────────────────────────────────────────────────────────┘')),
  ];

  return lines.join('\n');
}