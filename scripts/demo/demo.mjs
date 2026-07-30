import pty from 'node-pty';
import { setTimeout as sleep } from 'timers/promises';

const CHAR_DELAY_MS  = 55;
const CHAR_JITTER_MS = 25;

function jitter() {
  return Math.floor(Math.random() * CHAR_JITTER_MS);
}

async function type(shell, text) {
  for (const ch of text) {
    shell.write(ch);
    await sleep(CHAR_DELAY_MS + jitter());
  }
}

async function enter(shell, pauseAfterMs = 800) {
  shell.write('\r');
  await sleep(pauseAfterMs);
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

// Wait for shell to initialize
await pause(1500);

// Launch Daedalus
await type(shell, 'npx tsx src/index.ts');
await enter(shell, 8000);

// Wait for banner + REPL prompt to fully render
await pause(3000);

// Type the /spec command
await type(shell, '/spec "Add a helper function to validate version string format and export it in version.ts"');
await enter(shell, 1000);

// Wait for Daedalus to fetch and display the 3 clarification questions
// (API call + render takes a few seconds)
await pause(9000);

// /spec uses a SINGLE "Your answers:" prompt — type ALL answers on ONE line
await type(shell, '1. Strict SemVer major.minor.patch with optional pre-release like 1.0.0-beta. 2. Return boolean true if valid false if invalid. 3. Yes Vitest unit tests covering valid and invalid inputs.');
await enter(shell, 12000);

// Wait for spec generation + GitHub issue creation + Discord notification to complete
await pause(5000);

// Let the final screen linger so terminalizer captures it, then exit
await pause(4000);
await type(shell, '/exit');
await enter(shell, 1000);

// Keep the PTY alive so terminalizer detects the natural exit and saves
await pause(3000);
