import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { execSync, spawn } from 'child_process';

import { getConfigDirPath } from '../config/index.js';
import { getSystemDiagnostics } from '../config/systemInfo.js';
import type { Command } from './types.js';

// Redaction patterns
const API_KEY_PATTERN = /sk-[a-zA-Z0-9_-]+/g;
const AUTH_TOKEN_PATTERN = /Bearer\s+[a-zA-Z0-9_-]+|Basic\s+[a-zA-Z0-9=]+/g;
const GIT_REMOTE_PATTERN = /https?:\/\/(.*@)?(github\.com|gitlab\.com|bitbucket\.org)\/[^\/]+\/[^\/#]+/g;

export function redactSensitive(text: string): string {
  let result = text;

  // Redact home paths
  if (process.env.USERPROFILE) {
    result = result.replace(new RegExp(process.env.USERPROFILE, 'gi'), '[REDACTED_WINDOWS_PROFILE]');
  }
  if (process.env.HOME) {
    result = result.replace(new RegExp(process.env.HOME, 'gi'), '[REDACTED_HOME]');
  }

  // Redact API keys
  result = result.replace(API_KEY_PATTERN, '[REDACTED_API_KEY]');

  // Redact auth tokens
  result = result.replace(AUTH_TOKEN_PATTERN, '[REDACTED_AUTH_TOKEN]');

  // Redact git remote URLs
  result = result.replace(GIT_REMOTE_PATTERN, '[REDACTED_GIT_REMOTE]');

  return result;
}

export function sanitizeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  const allowed = new Set(['NODE_ENV', 'SHELL']);
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key)) {
      safe[key] = value ?? '';
    }
  }
  return safe;
}

async function openGitHubUrl(url: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      const tempPath = path.join(process.env.TMP || '', `clipboard-${Date.now()}.txt`);
      fs.writeFileSync(tempPath, url);
      execSync(`powershell -noprofile -command "Start-Process $(Get-Content \"${tempPath}\")"`, { stdio: 'inherit' });
      fs.unlinkSync(tempPath);
    } else if (process.platform === 'darwin') {
      const cp = spawn('open', ['-n', '-g', '--args', url]);
      await new Promise(resolve => cp.on('close', resolve));
    } else {
      const cp = spawn('xdg-open', [url]);
      await new Promise(resolve => cp.on('close', resolve));
    }
  } catch (err) {
    throw new Error(`Failed to open browser: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      const tempPath = path.join(process.env.TMP || '', `clipboard-${Date.now()}.txt`);
      fs.writeFileSync(tempPath, text);
      execSync(`powershell -noprofile -command "Set-Clipboard -Path \"${tempPath}\""`, { stdio: 'inherit' });
      fs.unlinkSync(tempPath);
    } else if (process.platform === 'darwin') {
      const cp = spawn('pbcopy', { stdio: ['pipe', 'pipe', 'pipe'] });
      cp.stdin.end(text);
      await new Promise(resolve => cp.on('close', resolve));
    } else {
      const cp = spawn('xclip', ['-selection', 'clipboard', '-t', 'text/plain']);
      cp.stdin.end(text);
      await new Promise(resolve => cp.on('close', resolve));
    }
  } catch {
    // Silently fail — clipboard is optional
  }
}

export const feedbackCommand: Command = {
  name: '/feedback',
  aliases: ['report'],
  description: 'Send bug reports or feature requests to the Daedalus team',
  usage: '/feedback',
  helpText: 'Opens an interactive form to submit feedback. The report includes sanitized environment diagnostics and is either opened in your browser as a pre-filled GitHub issue or sent to a configured Discord webhook.',
  execute: async (args, ctx) => {
    const configDir = getConfigDirPath();
    const configPath = path.join(configDir, 'config.json');

    // Load Discord webhook from config or env
    let discordWebhookUrl: string | null = null;
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        discordWebhookUrl = parsed.discordWebhook || process.env.DISCORD_WEBHOOK_URL || null;
      } else {
        discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || null;
      }
    } catch {
      discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || null;
    }

    // Collect metadata
    const diag = getSystemDiagnostics();
    const nodeVersion = process.version;
    const daedalusVersion = await (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(configDir, '..', 'package.json'), 'utf8'));
        return pkg.version || 'unknown';
      } catch {
        return 'unknown';
      }
    })();

    const modelTier = ctx.config.router.chain.length > 0 ? ctx.config.router.chain[0].tier || 'standard' : 'none';
    const tuiActive = ctx.config.ui.tui ? 'yes' : 'no';

    // Interactive prompts
    console.log(pc.cyan('\n=== Daedalus Feedback ===\n'));

    const issueType = await ctx.askLine('Issue Type [Bug Report/Feature Request]: ') || 'Bug Report';
    const title = await ctx.askLine('Short Title: ') || `${issueType} Feedback`;
    const description = await ctx.askLine('Description/Steps to Reproduce:\n> ');

    let errorSnippet = '';
    const attachError = await ctx.askLine('Attach recent error log? [Y/n]: ') || 'Y';
    if (attachError.toLowerCase().startsWith('y')) {
      errorSnippet = '[No recent error log available. Error capture would be implemented via session integration.]';
    }

    // Build markdown payload
    const markdown = `## Overview
${description}

## Issue Type
${issueType}

## Reproduction Steps
${issueType === 'Bug Report' ? description : 'N/A (Feature Request)'}

## Environment Diagnostics
- **OS**: ${diag.osName} (${diag.platform}, ${diag.arch})
- **Shell**: ${diag.shell}
- **CPUs**: ${diag.cpus}
- **RAM**: ${diag.totalMemoryGB} GB total, ${diag.freeMemoryGB} GB free
- **Node.js**: ${nodeVersion}
- **Daedalus Version**: ${daedalusVersion}
- **Model Tier**: ${modelTier}
- **TUI Active**: ${tuiActive}

## Environment Variables (Sanitized)
${Object.entries(sanitizeEnv()).map(([k, v]) => `  - ${k}: ${v}`).join('\n')}

## Error Log (Optional)
${errorSnippet.trim() || 'N/A'}

---
*Generated by Daedalus CLI feedback command. All sensitive data has been automatically redacted.*
`;

    const sanitizedMarkdown = redactSensitive(markdown);

    // Determine destination
    const githubTitle = encodeURIComponent(`${issueType}: ${title}`);
    const githubBody = encodeURIComponent(sanitizedMarkdown.replace(/\r/g, ''));
    // Add appropriate labels based on issue type
    const labelParam = issueType.toLowerCase().includes('bug') ? 'bug,feedback' : 'feature,feedback';
    const githubUrl = `https://github.com/bgill55/daedalus/issues/new?title=${githubTitle}&body=${githubBody}&labels=${labelParam}`;

    console.log(pc.green('\n[OK] Feedback prepared. Sending to:'));

    if (discordWebhookUrl) {
      const choice = await ctx.askLine('Options: 1) Open GitHub Issue  2) Post to Discord Webhook (default: 1): ') || '1';

      if (choice === '2' && discordWebhookUrl) {
        try {
          await fetch(discordWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: sanitizedMarkdown }),
          });
          console.log(pc.green('✔ Feedback posted to Discord webhook.'));
          await copyToClipboard(sanitizedMarkdown);
          console.log(pc.gray('  (Copied to clipboard as fallback.)'));
        } catch (err) {
          console.log(pc.red(`✗ Discord webhook failed: ${(err instanceof Error ? err.message : String(err))}`));
          console.log(pc.gray('  Falling back to GitHub URL + clipboard.'));
        }
      }

      // Always open GitHub as primary (user gets to edit)
      try {
        await openGitHubUrl(githubUrl);
      } catch (err) {
        console.log(pc.red(`✗ Failed to open browser: ${(err instanceof Error ? err.message : String(err))}`));
        console.log(pc.gray('  Copying to clipboard instead.'));
        await copyToClipboard(sanitizedMarkdown);
      }
    } else {
      // No Discord — just GitHub
      try {
        await openGitHubUrl(githubUrl);
      } catch (err) {
        console.log(pc.red(`✗ Failed to open browser: ${(err instanceof Error ? err.message : String(err))}`));
        console.log(pc.gray('  Copying to clipboard instead.'));
        await copyToClipboard(sanitizedMarkdown);
      }
    }

    console.log(pc.gray(`\nGitHub Issue URL: ${githubUrl}`));
    console.log(pc.gray('You can edit this before submitting.'));
    return true;
  },
};