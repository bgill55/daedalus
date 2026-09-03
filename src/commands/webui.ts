import pc from 'picocolors';
import { exec } from 'node:child_process';
import { startServer, stopServer, getTelemetryRate, setTelemetryRate, PORT, HOST } from '../webui/server.js';
import type { Command } from './types.js';

let isServerRunning = false;

export const webuiCommand: Command = {
  name: '/webui',
  description: 'Companion Web UI dashboard manager',
  usage: '/webui [start|stop|open|status|rate <ms>]',
  helpText: `Daedalus Companion Web UI:
  /webui start      Start the local Web UI server (http://127.0.0.1:3888)
  /webui stop       Stop the running Web UI server
  /webui open       Open the Web UI dashboard in the default browser
  /webui status     Check if the Web UI server is active
  /webui rate <ms>  Get or dynamically adjust the telemetry stream refresh rate (100ms-60000ms)`,
  execute: async (args, _ctx) => {
    const parts = args.trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase() || 'status';

    if (sub === 'rate') {
      const valStr = parts[1];
      if (!valStr) {
        console.log(pc.cyan(`\n[webui] Current telemetry refresh rate: ${pc.bold(`${getTelemetryRate()}ms`)}`));
        return;
      }
      const parsed = parseInt(valStr, 10);
      if (isNaN(parsed) || parsed < 100 || parsed > 60000) {
        console.log(pc.yellow(`\n[webui] Invalid rate: "${valStr}". Must be between 100ms and 60000ms.`));
        return;
      }
      const updated = setTelemetryRate(parsed);
      console.log(pc.bold(pc.green(`\n[webui] Telemetry refresh rate dynamically updated to ${updated}ms.`)));
      return;
    }

    if (sub === 'start') {
      if (isServerRunning) {
        console.log(pc.green(`\n[webui] Server already running at http://${HOST}:${PORT}`));
        return;
      }
      try {
        await startServer();
        isServerRunning = true;
        console.log(pc.bold(pc.green(`\n[webui] Companion Web UI started at http://${HOST}:${PORT}`)));
      } catch (err: any) {
        isServerRunning = false;
        console.log(pc.red(`\n[webui] Failed to start server: ${err.message}`));
      }
      return;
    }

    if (sub === 'stop') {
      if (!isServerRunning) {
        console.log(pc.yellow('\n[webui] Server is not running.'));
        return;
      }
      try {
        await stopServer();
        isServerRunning = false;
        console.log(pc.cyan('\n[webui] Companion Web UI server stopped.'));
      } catch (err: any) {
        console.log(pc.red(`\n[webui] Error stopping server: ${err.message}`));
      }
      return;
    }

    if (sub === 'open') {
      const url = `http://${HOST}:${PORT}`;
      if (!isServerRunning) {
        try {
          await startServer();
          isServerRunning = true;
        } catch (err: any) {
          console.log(pc.red(`\n[webui] Failed to start server: ${err.message}`));
          return;
        }
      }
      console.log(pc.cyan(`\n[webui] Opening ${url} in your browser...`));
      const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${opener} ${url}`);
      return;
    }

    if (sub === 'status') {
      console.log(pc.bold(`\n=== DAEDALUS WEB UI STATUS ===`));
      console.log(`  ${pc.bold('Status:')}  ${isServerRunning ? pc.green('● ACTIVE') : pc.gray('○ STOPPED')}`);
      console.log(`  ${pc.bold('URL:')}     http://${HOST}:${PORT}`);
      console.log(`  ${pc.bold('Stream:')}  http://${HOST}:${PORT}/telemetry`);
      console.log(`  ${pc.bold('Rate:')}    ${getTelemetryRate()}ms`);
      console.log();
      return;
    }

    console.log(pc.yellow(`\nUnknown subcommand: "${sub}". Usage: /webui [start|stop|open|status|rate <ms>]`));
  },
};
