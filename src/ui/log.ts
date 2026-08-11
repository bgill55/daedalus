import pc from 'picocolors';

// Severity-tiered console output. The goal is that a new user can skim a run by
// salience: routine self-correction is dim/gray (not an alarm), real non-fatal
// problems are yellow, and actual failures are red. Permission prompts are blue
// so they are never confused with warnings.
export const log = {
  // Routine, expected events (retries, model switches, checkpoints). Never an alarm.
  info: (msg: string): void => {
    console.log(pc.dim(msg));
  },
  // Progress / positive signals (recovered, todo progress, completion checks).
  progress: (msg: string): void => {
    console.log(pc.cyan(msg));
  },
  // A question directed at the user (e.g. "Allow?"). Must look like a prompt,
  // never like a warning or error.
  prompt: (msg: string): void => {
    process.stdout.write(pc.blue(msg));
  },
  // Genuine non-fatal problem the user should know about (webhook down, index failed).
  warn: (msg: string): void => {
    console.log(pc.yellow(msg));
  },
  // Actual failure requiring user attention.
  error: (msg: string): void => {
    console.log(pc.red(msg));
  },
};
