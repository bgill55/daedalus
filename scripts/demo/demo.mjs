import pty from 'node-pty';
import { setTimeout as sleep } from 'timers/promises';

const CHAR_DELAY_MS  = 55;
const CHAR_JITTER_MS = 25;
const LINE_PAUSE_MS  = 800;

function jitter() {
  return Math.floor(Math.random() * CHAR_JITTER_MS);
}

async function type(shell, text) {
  for (const ch of text) {
    shell.write(ch);
    await sleep(CHAR_DELAY_MS + jitter());
  }
}

async function enter(shell, pauseAfterMs = LINE_PAUSE_MS) {
  shell.write('\r');
  await sleep(pauseAfterMs);
}

async function line(shell, text, pauseAfterMs = LINE_PAUSE_MS) {
  await type(shell, text);
  await enter(shell, pauseAfterMs);
}

async function pause(ms) {
  await sleep(ms);
}

const shell = pty.spawn('powershell.exe', ['-NoLogo', '-NoProfile'], {
  name:  'xterm-256color',
  cols:  110,
  rows:  36,
  cwd:   'D:\\Daedalus',
  env:   { ...process.env, FORCE_COLOR: '3' },
});

shell.onData(data => process.stdout.write(data));

await pause(1200);

await line(shell, 'npx tsx src/index.ts', 6000);

await pause(2000);

await type(shell, '/spec "Add a helper function to validate version string format and export it in version.ts"');
await pause(600);
await enter(shell, 5000);

await pause(2000);

await line(shell, '1. Strict SemVer: major.minor.patch with optional pre-release (e.g. 1.0.0-beta)', 3000);

await line(shell, '2. Return boolean true if valid, false if invalid', 3000);

await line(shell, '3. Yes — Vitest unit tests covering valid and invalid inputs', 8000);

await pause(3000);

await line(shell, '/loop', 4000);

await pause(15000);

shell.write('\x03');
await pause(1000);

await line(shell, 'exit', 1000);
