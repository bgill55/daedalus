import pc from 'picocolors';
import type { Command, CommandContext } from './types.js';
import { scanAiRepos } from '../tools/builtin/scan-ai-repos.js';

function parseArgs(input: string): { top?: number; query?: string; issue?: boolean; repo?: string } {
  const out: { top?: number; query?: string; issue?: boolean; repo?: string } = {};
  const topMatch = input.match(/--top\s+(\d+)/);
  if (topMatch) out.top = Number(topMatch[1]);
  const queryMatch = input.match(/--query\s+"([^"]*)"/);
  if (queryMatch) out.query = queryMatch[1];
  if (/\s--issue\b/.test(input)) out.issue = true;
  const repoMatch = input.match(/--repo\s+(\S+)/);
  if (repoMatch) out.repo = repoMatch[1];
  return out;
}

export const scanAiReposCommands: Command[] = [
  {
    name: '/scan-ai-repos',
    description: 'Scan top AI repos on GitHub, diff their patterns against this project, and optionally open a GitHub issue with file-specific suggestions.',
    usage: '/scan-ai-repos [--top N] [--query "topic:..."] [--issue] [--repo owner/name]',
    helpText: [
      pc.cyan('Usage: /scan-ai-repos [--top N] [--query "topic:..."] [--issue] [--repo owner/name]'),
      '',
      'Scans GitHub for the most-starred AI repositories, analyzes each against this',
      'project via the local code index (FTS), and prints file-specific suggestions.',
      '',
      pc.yellow('Flags:'),
      '  --top N        Number of top repos to include (default 10, max 20).',
      '  --query "..."  GitHub search query (default: "topic:ai stars:>1000").',
      '  --issue        Open a GitHub issue with the report (via `gh`).',
      '  --repo owner/name  Target repo for the issue (default: git remote origin,',
      '                 then bgill55/daedalus).',
    ].join('\n'),
    execute: async (args: string, ctx: CommandContext) => {
      const parsed = parseArgs(args ?? '');
      const result = await scanAiRepos(parsed, ctx.toolContext);
      console.log(result.content);
      if (!result.success && result.error) {
        console.log(pc.red(`\n${result.error}`));
      }
    },
  },
];
