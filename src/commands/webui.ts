import pc from 'picocolors';
import { exec } from 'node:child_process';
import { startServer, PORT, HOST } from '../webui/server.js';
import type { Command } from './types.js';

let runningServer: ReturnType<typeof startServer> | null = null;

export const webuiCommand: Command = {
  name: '/webui',
  description: 'Companion Web UI dashboard manager',
  usage: '/webui [start|stop|open|status]',
  helpText: `Daedalus Companion Web UI:
  /webui start    Start the local Web UI server (http://localhost:3888)
  /webui stop     Stop the running Web UI server
  /webui open     Open the Web UI dashboard in the default browser
  /webui status   Check if the Web UI server is active`,
  execute: async (args, _ctx) => {
    const sub = args.trim().toLowerCase() || 'status';

    if (sub === 'start') {
      if (runningServer) {
        console.log(pc.green(`\n[webui] Server already running at http://${HOST}:${PORT}`));
        return;
      }
      try {
        runningServer = startServer();
        console.log(pc.bold(pc.green(`\n[webui] Companion Web UI started at http://${HOST}:${PORT}`)));
      } catch (err: any) {
        console.log(pc.red(`\n[webui] Failed to start server: ${err.message}`));
      }
      return;
    }

    if (sub === 'stop') {
      if (!runningServer) {
        console.log(pc.yellow('\n[webui] Server is not running.'));
        return;
      }
      runningServer.close(() => {
        runningServer = null;
        console.log(pc.cyan('\n[webui] Companion Web UI server stopped.'));
      });
      return;
    }

    if (sub === 'open') {
      const url = `http://${HOST}:${PORT}`;
      if (!runningServer) {
        runningServer = startServer();
      }
      console.log(pc.cyan(`\n[webui] Opening ${url} in your browser...`));
      const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${opener} ${url}`);
      return;
    }

    if (sub === 'status') {
      const isRunning = Boolean(runningServer);
      console.log(pc.bold(`\n=== DAEDALUS WEB UI STATUS ===`));
      console.log(`  ${pc.bold('Status:')}  ${isRunning ? pc.green('● ACTIVE') : pc.gray('○ STOPPED')}`);
      console.log(`  ${pc.bold('URL:')}     http://${HOST}:${PORT}`);
      console.log(`  ${pc.bold('Stream:')}  http://${HOST}:${PORT}/telemetry`);
      console.log();
      return;
    }

    console.log(pc.yellow(`\nUnknown subcommand: "${sub}". Usage: /webui [start|stop|open|status]`));
  },
};
