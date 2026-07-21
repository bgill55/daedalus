import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateImage, generateImageTool } from './image.js';

describe('generateImage tool', () => {
  const tmpDir = path.join(process.cwd(), '.tmp_test_image');

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('has correct tool definition metadata', () => {
    expect(generateImageTool.function.name).toBe('generate_image');
    expect(generateImageTool.function.parameters.required).toContain('prompt');
  });

  it('handles API failure gracefully when provider is explicitly sd-webui and server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await generateImage({
      prompt: 'a futuristic robot arm',
      provider: 'sd-webui',
      output_path: path.join(tmpDir, 'test_fail.png'),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('decodes base64 and saves PNG file on successful local SD API response', async () => {
    const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: [fakeBase64] }),
    } as Response);

    const outputPath = path.join(tmpDir, 'test_out_sd.png');
    const result = await generateImage({
      prompt: 'a vibrant sunset over mountains',
      width: 512,
      height: 512,
      provider: 'sd-webui',
      output_path: outputPath,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('local Stable Diffusion');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('fetches image from Pollinations AI when provider is pollinations', async () => {
    const fakeBuffer = Buffer.from('fake-png-binary-data');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeBuffer.buffer,
    } as Response);

    const outputPath = path.join(tmpDir, 'test_out_pollinations.png');
    const result = await generateImage({
      prompt: 'a cyberpunk neon skyline',
      width: 512,
      height: 512,
      provider: 'pollinations',
      output_path: outputPath,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Pollinations AI');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('falls back to Pollinations AI when provider is auto and local SD fails', async () => {
    const fakeBuffer = Buffer.from('fake-png-binary-data');

    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) // local SD attempt fails
      .mockResolvedValueOnce({                           // Pollinations fallback succeeds
        ok: true,
        arrayBuffer: async () => fakeBuffer.buffer,
      } as Response);

    const outputPath = path.join(tmpDir, 'test_out_fallback.png');
    const result = await generateImage({
      prompt: 'a majestic dragon',
      provider: 'auto',
      output_path: outputPath,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Pollinations AI');
    expect(fs.existsSync(outputPath)).toBe(true);
  });
});
