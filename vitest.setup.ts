process.on('uncaughtException', (err) => {
  process.stderr.write(`[vitest-worker PID=${process.pid}] UNCAUGHT EXCEPTION: ${err?.stack ?? err}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[vitest-worker PID=${process.pid}] UNHANDLED REJECTION: ${reason}\n`);
});
process.stderr.write(`[vitest-worker PID=${process.pid}] worker started\n`);
