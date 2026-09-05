import { describe, it, expect } from 'vitest';
import { generateQrCode, getWebSocketUrl } from './qr.js';

describe('QR Code Generation & WebSocket Pairing (M-5 / M-6)', () => {
  it('generates a valid PNG buffer encoding a WebSocket URL', async () => {
    const url = 'ws://192.168.1.100:3888';
    const buffer = await generateQrCode(url);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(50);
    // Check PNG header (0x89 0x50 0x4E 0x47)
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4E);
    expect(buffer[3]).toBe(0x47);
  });

  it('constructs default WebSocket URL for host and port', () => {
    const wsUrl = getWebSocketUrl('127.0.0.1', 3888);
    expect(wsUrl).toBe('ws://127.0.0.1:3888');
  });

  it('respects WS_URL environment override when set', () => {
    const prevEnv = process.env.WS_URL;
    process.env.WS_URL = 'wss://my-custom-tailscale.ts.net';
    try {
      const wsUrl = getWebSocketUrl('127.0.0.1', 3888);
      expect(wsUrl).toBe('wss://my-custom-tailscale.ts.net');
    } finally {
      if (prevEnv) process.env.WS_URL = prevEnv;
      else delete process.env.WS_URL;
    }
  });
});
