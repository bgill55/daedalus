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
    expect(generateImageTool.name).toBe('generate_image');
    expect(generateImageTool.parameters.required).toContain('prompt');
  });

  it('handles API failure gracefully when SD WebUI server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await generateImage({
      prompt: 'a futuristic robot arm',
      output_path: path.join(tmpDir, 'test_fail.png'),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('decodes base64 and saves PNG file on successful API response', async () => {
    // 1x1 transparent PNG base64
    const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: [fakeBase64] }),
    } as Response);

    const outputPath = path.join(tmpDir, 'test_out.png');
    const result = await generateImage({
      prompt: 'a vibrant sunset over mountains',
      width: 512,
      height: 512,
      output_path: outputPath,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Successfully generated image');
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
  });
});
