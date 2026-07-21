import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolResult } from '../../types.js';
import { loadConfig } from '../../config/index.js';

export interface GenerateImageArgs {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  output_path?: string;
}

export async function generateImage(args: GenerateImageArgs): Promise<ToolResult> {
  try {
    const config = loadConfig();
    const imgGenConfig = config.imageGen;

    if (imgGenConfig && !imgGenConfig.enabled) {
      return {
        success: false,
        output: '',
        error: 'Image generation is currently disabled in Daedalus configuration.',
      };
    }

    const endpoint = imgGenConfig?.endpoint || 'http://127.0.0.1:7860';
    const url = `${endpoint.replace(/\/+$/, '')}/sdapi/v1/txt2img`;

    const width = args.width || imgGenConfig?.defaultWidth || 512;
    const height = args.height || imgGenConfig?.defaultHeight || 512;
    const steps = args.steps || imgGenConfig?.defaultSteps || 20;

    const payload = {
      prompt: args.prompt,
      negative_prompt: args.negative_prompt || 'low quality, blurry, distorted, watermark',
      width,
      height,
      steps,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        output: '',
        error: `Stable Diffusion API returned HTTP ${response.status}: ${text}`,
      };
    }

    const data = (await response.json()) as { images?: string[] };
    if (!data.images || data.images.length === 0) {
      return {
        success: false,
        output: '',
        error: 'No image data returned from Stable Diffusion API.',
      };
    }

    const base64Data = data.images[0];
    const buffer = Buffer.from(base64Data, 'base64');

    let targetPath = args.output_path;
    if (!targetPath) {
      const dir = imgGenConfig?.outputDir || './assets/images';
      const filename = `sd_${Date.now()}.png`;
      targetPath = path.join(dir, filename);
    }

    const absolutePath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(process.cwd(), targetPath);

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);

    return {
      success: true,
      output: `Successfully generated image (${width}x${height}, ${steps} steps).\nSaved to: ${absolutePath}`,
    };
  } catch (err: any) {
    return {
      success: false,
      output: '',
      error: `Failed to generate image via Stable Diffusion API: ${err.message || String(err)}`,
    };
  }
}

export const generateImageTool: Tool = {
  name: 'generate_image',
  description: 'Generate an image using a local Stable Diffusion WebUI instance and save it to disk.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed prompt describing the image to generate.',
      },
      negative_prompt: {
        type: 'string',
        description: 'Negative prompt specifying elements to avoid in the generated image.',
      },
      width: {
        type: 'number',
        description: 'Image width in pixels (default 512).',
      },
      height: {
        type: 'number',
        description: 'Image height in pixels (default 512).',
      },
      steps: {
        type: 'number',
        description: 'Sampling steps for image generation (default 20).',
      },
      output_path: {
        type: 'string',
        description: 'Relative or absolute file path to save the generated PNG image (default ./assets/images/sd_<timestamp>.png).',
      },
    },
    required: ['prompt'],
  },
  execute: generateImage,
};
