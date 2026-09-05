import QRCode from 'qrcode';

/**
 * Generate a QR code PNG buffer encoding the given WebSocket URL.
 * @param url - The WebSocket URL to encode (e.g., ws://192.168.1.10:3888)
 * @param options - Optional qrcode options for size and error correction
 * @returns Promise resolving to a PNG buffer
 */
export async function generateQrCode(
  url: string,
  options?: QRCode.QRCodeToBufferOptions
): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    ...options,
  });
}

/**
 * Return the local WebSocket URL for the given host and port.
 * Falls back to process.env.WS_URL or ws://localhost:<port> when
 * no explicit host is provided.
 */
export function getWebSocketUrl(host: string, port: number): string {
  const envUrl = process.env.WS_URL;
  if (envUrl && (envUrl.startsWith('ws://') || envUrl.startsWith('wss://'))) {
    return envUrl;
  }
  return `ws://${host}:${port}`;
}
