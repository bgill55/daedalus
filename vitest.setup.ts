// Set Windows file watcher to polling mode to avoid fs-event assertion errors
if (process.platform === 'win32') {
  process.env.CHOKIDAR_USEPOLLING = 'true';
  process.env.CHOKIDAR_POLL_INTERVAL = '100';
  process.env.WATCHMAN_DISABLED = 'true';
}

process.on('uncaughtException', (err) => {
  process.stderr.write(`[vitest-worker PID=${process.pid}] UNCAUGHT EXCEPTION: ${err?.stack ?? err}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[vitest-worker PID=${process.pid}] UNHANDLED REJECTION: ${reason}\n`);
});
process.stderr.write(`[vitest-worker PID=${process.pid}] worker started\n`);
