import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSafe } from '../utils/spawn.js';
import { commandsList } from '../commands.js';

function getRecentChangelogInfo(): { version: string; recentNotes: string } {
  let version = '3.78.1';
  let recentNotes = '';

  const candidateDirs = [
    process.cwd(),
    path.dirname(fileURLToPath(import.meta.url)),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  ];

  for (const dir of candidateDirs) {
    try {
      const pkgPath = path.resolve(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.version) {
          version = pkg.version;
          break;
        }
      }
    } catch {
    }
  }

  for (const dir of candidateDirs) {
    try {
      const changelogPath = path.resolve(dir, 'CHANGELOG.md');
      if (fs.existsSync(changelogPath)) {
        const content = fs.readFileSync(changelogPath, 'utf8');
        const lines = content.split('\n');
        const filtered: string[] = [];
        let headerCount = 0;

        for (const line of lines) {
          if (/^#+ \[?\d+\.\d+\.\d+/.test(line)) {
            headerCount++;
            if (headerCount > 4) break;
          }
          if (headerCount > 0) {
            filtered.push(line);
          }
        }
        recentNotes = filtered.join('\n').trim();
        if (recentNotes) break;
      }
    } catch {
    }
  }

  if (!recentNotes) {
    try {
      recentNotes = execSafe('git log -n 10 --oneline', { encoding: 'utf8' }).trim();
    } catch {
      recentNotes = 'Long-horizon Marathon engine, multi-agent Pantheon orchestration, sigma-mem persistence, and responsive WebUI companion.';
    }
  }

  return { version, recentNotes };
}

export function getBotSystemPrompt(username?: string): string {
  const { version, recentNotes } = getRecentChangelogInfo();

  const isCreator = username && (
    username.toLowerCase().includes('bgill55') ||
    username.toLowerCase().includes('bgill55.art') ||
    username.toLowerCase().includes('brica')
  );

  return `You are Daedalus, the AI coding companion for Daedalus (daedalus-cli v${version}).

## PERSONA
- Witty, sarcastic, highly capable senior software engineer.
- Playful banter is welcome, but always directly answer the user's question with accurate technical detail.
- Keep responses concise, clean, and formatted with markdown lists or code blocks (no markdown tables, no XML wrapper tags like <DAEDALUS>, and no outer angle brackets).
${isCreator ? `- You are chatting with Brian (@${username}), the creator of Daedalus. Greet him naturally by name (Brian) and answer his request.` : ''}

## SYSTEM KNOWLEDGE
- **Current Version:** v${version} (npm: \`daedalus-cli@latest\`)
- **Recent Updates:**
${recentNotes}
- **Pantheon Architecture (7 Agents):** Daedalus (Orchestrator), Themis (Spec), Metis (Planner), Hephaestus (Coder), Apollo (Reviewer), Asclepius (Debugger), Mnemosyne (Researcher).
- **Marathon Engine:** Multi-day autonomous milestone DAG execution and checkpoint rollbacks.
- **$\Sigma$-Mem:** SQLite memory engine with content deduplication and tag-ranked recall.
- **WebUI:** Local dashboard with live telemetry, visual git diffs, and mobile QR pairing.`;
}
