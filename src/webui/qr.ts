import QRCode from 'qrcode';
import os from 'node:os';

/**
 * Detect primary local network IPv4 address for mobile pairing over Wi-Fi / LAN.
 */
export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Generate a QR code PNG buffer encoding the given WebSocket or Web URL.
 * @param url - The URL to encode (e.g., http://192.168.1.10:3888)
 * @param options - Optional qrcode options for size and error correction
 * @returns Promise resolving to a PNG buffer
 */
export async function generateQrCode(
  url: string,
  options?: QRCode.QRCodeToBufferOptions
): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    margin: 2,
    scale: 8,
    color: {
      dark: '#f5c358', // glowing mythic gold pixels
      light: '#0b0f19', // deep obsidian dark void background
    },
    ...options,
  });
}

/**
 * Return the local WebSocket URL for the given host and port.
 * Falls back to process.env.WS_URL or ws://<host>:<port>.
 */
export function getWebSocketUrl(host = '127.0.0.1', port = 3888): string {
  const envUrl = process.env.WS_URL;
  if (envUrl && (envUrl.startsWith('ws://') || envUrl.startsWith('wss://'))) {
    return envUrl;
  }
  return `ws://${host}:${port}`;
}

/**
 * Return the Web pairing URL for mobile camera scanning.
 * Resolves to the local LAN IP (e.g., http://192.168.x.x:3888) or process.env.WEBUI_URL.
 */
export function getWebPairingUrl(host?: string, port = 3888): string {
  const envUrl = process.env.WEBUI_URL;
  if (envUrl && (envUrl.startsWith('http://') || envUrl.startsWith('https://'))) {
    return envUrl;
  }
  const effectiveHost = (!host || host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost')
    ? getLocalIpAddress()
    : host;
  return `http://${effectiveHost}:${port}`;
}
