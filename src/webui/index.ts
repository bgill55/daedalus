/**
 * Daedalus Web UI entry point.
 *
 * This module initializes the web UI runtime and exposes a readiness flag
 * so other parts of the application can detect when the UI layer is loaded.
 */

export const webuiReady = true;

export function initWebUI(): void {
  console.info('[webui] Daedalus Web UI initialized');
}

initWebUI();
