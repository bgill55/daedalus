import pc from 'picocolors';
import { globalSessionStats } from '../session/analytics.js';

export function handleStatsCommand(): string {
  const report = globalSessionStats.getReport();

  const lines = [
    pc.bold(pc.cyan('┌─ Session & System Statistics ─────────────────────────────┐')),
    `│ ${pc.bold('Uptime:')}          ${report.uptime.padEnd(41)} │`,
    `│ ${pc.bold('Interactions:')}    ${report.totalInteractions.toString().padEnd(41)} │`,
    `│ ${pc.bold('Total Tokens:')}    ${report.totalTokens.toLocaleString().padEnd(41)} │`,
    `│ ${pc.bold('Prompt Tokens:')}   ${report.promptTokens.toLocaleString().padEnd(41)} │`,
    `│ ${pc.bold('Completion:')}      ${report.completionTokens.toLocaleString().padEnd(41)} │`,
    `│ ${pc.bold('Error Count:')}     ${report.totalErrors.toString().padEnd(41)} │`,
    pc.bold(pc.cyan('└───────────────────────────────────────────────────────────┘')),
  ];

  return lines.join('\n');
}
