import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

export const TIPS: string[] = [
  'Press ↑/↓ in the REPL to recall past commands — history persists across sessions in ~/.daedalus/history.',
  'Set ui.diffStyle to "side-by-side" in config for a two-column patch review.',
  'Run /stats to see live token usage, tool-call counts, and the last routed model.',
  'Use /theme light if your terminal has a white background for readable colors.',
  'Pipe a casual idea through /enhance to turn it into a structured engineering prompt.',
  'Enable ui.showCost to estimate per-turn spend on cloud models (local models stay $0).',
  'Tag a file with /context add to keep it in every prompt without re-pasting it.',
  'Set ui.streaming to false for buffered replies if live streaming feels noisy.',
  'Run /health to verify provider latency and API-key status before a long session.',
  'Use /autopilot "<feature>" to plan, implement, verify, and open a PR end-to-end.',
  'Use /hunt <test> to autonomously find and fix a failing test, then open a PR.',
  'Pin a flaky model out of the router with /model and watch routing decisions in /why.',
];

interface TipState {
  date: string;
  index: number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Return one tip per day, rotating through the list. The chosen index is
 * persisted to <configDir>/tips.json keyed by date so the same tip shows for
 * the whole day and advances the next day. Falls back to a deterministic pick
 * if the file can't be read/written.
 */
export function getTipOfDay(configDir: string): string {
  const tipPath = path.join(configDir, 'tips.json');
  const today = todayKey();
  let state: TipState = { date: today, index: 0 };

  try {
    if (fs.existsSync(tipPath)) {
      const raw = fs.readFileSync(tipPath, 'utf8').trim();
      if (raw) state = JSON.parse(raw) as TipState;
    }
  } catch {
    // ignore — fall back to deterministic index
  }

  let idx = state.index;
  if (state.date !== today) {
    idx = (state.index + 1) % TIPS.length;
    state = { date: today, index: idx };
    try {
      fs.mkdirSync(path.dirname(tipPath), { recursive: true });
      fs.writeFileSync(tipPath, JSON.stringify(state), 'utf8');
    } catch {
      // ignore — tip-of-day is best-effort
    }
  }

  const tip = TIPS[idx % TIPS.length];
  return `${pc.cyan('Tip')} ${pc.dim('of the day:')} ${tip}`;
}
