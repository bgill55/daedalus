import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition, ToolResult } from '../../types.js';
import { loadConfig } from '../../config/index.js';

export interface GenerateImageArgs {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  provider?: 'auto' | 'sd-webui' | 'pollinations';
  output_path?: string;
}

async function fetchFromPollinations(
  prompt: string,
  width: number,
  height: number,
  output_path?: string,
  outputDir = './assets/images'
): Promise<ToolResult> {
  const seed = Math.floor(Math.random() * 1000000);
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${seed}`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    return {
      toolCallId: '',
      name: 'generate_image',
      success: false,
      content: '',
      error: `Pollinations AI returned HTTP ${response.status}: ${text}`,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let targetPath = output_path;
  if (!targetPath) {
    const filename = `img_${Date.now()}.png`;
    targetPath = path.join(outputDir, filename);
  }

  const absolutePath = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(process.cwd(), targetPath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, buffer);

  return {
    toolCallId: '',
    name: 'generate_image',
    success: true,
    content: `Successfully generated image via Pollinations AI (${width}x${height}).\nSaved to: ${absolutePath}`,
  };
}

export async function generateImage(args: GenerateImageArgs): Promise<ToolResult> {
  try {
    const config = loadConfig();
    const imgGenConfig = config.imageGen;

    if (imgGenConfig && !imgGenConfig.enabled) {
      return {
        toolCallId: '',
        name: 'generate_image',
        success: false,
        content: '',
        error: 'Image generation is currently disabled in Daedalus configuration.',
      };
    }

    const provider = args.provider || imgGenConfig?.provider || 'auto';
    const width = args.width || imgGenConfig?.defaultWidth || 512;
    const height = args.height || imgGenConfig?.defaultHeight || 512;
    const steps = args.steps || imgGenConfig?.defaultSteps || 20;
    const outputDir = imgGenConfig?.outputDir || './assets/images';

    if (provider === 'pollinations') {
      return await fetchFromPollinations(args.prompt, width, height, args.output_path, outputDir);
    }

    // Try Local Stable Diffusion WebUI
    const endpoint = imgGenConfig?.endpoint || 'http://127.0.0.1:7860';
    const url = `${endpoint.replace(/\/+$/, '')}/sdapi/v1/txt2img`;

    const payload = {
      prompt: args.prompt,
      negative_prompt: args.negative_prompt || 'low quality, blurry, distorted, watermark',
      width,
      height,
      steps,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = (await response.json()) as { images?: string[] };
        if (data.images && data.images.length > 0) {
          const base64Data = data.images[0];
          const buffer = Buffer.from(base64Data, 'base64');

          let targetPath = args.output_path;
          if (!targetPath) {
            const filename = `sd_${Date.now()}.png`;
            targetPath = path.join(outputDir, filename);
          }

          const absolutePath = path.isAbsolute(targetPath)
            ? targetPath
            : path.resolve(process.cwd(), targetPath);

          fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
          fs.writeFileSync(absolutePath, buffer);

          return {
            toolCallId: '',
            name: 'generate_image',
            success: true,
            content: `Successfully generated image via local Stable Diffusion (${width}x${height}, ${steps} steps).\nSaved to: ${absolutePath}`,
          };
        }
      }

      if (provider === 'sd-webui') {
        const text = await response.text();
        return {
          toolCallId: '',
          name: 'generate_image',
          success: false,
          content: '',
          error: `Stable Diffusion API returned HTTP ${response.status}: ${text}`,
        };
      }
    } catch (sdErr: any) {
      if (provider === 'sd-webui') {
        return {
          toolCallId: '',
          name: 'generate_image',
          success: false,
          content: '',
          error: `Failed to connect to local Stable Diffusion WebUI at ${endpoint}: ${sdErr.message || String(sdErr)}`,
        };
      }
    }

    // Fallback to Pollinations AI if provider === 'auto' and local SD failed
    return await fetchFromPollinations(args.prompt, width, height, args.output_path, outputDir);
  } catch (err: any) {
    return {
      toolCallId: '',
      name: 'generate_image',
      success: false,
      content: '',
      error: `Failed to generate image: ${err.message || String(err)}`,
    };
  }
}

export const generateImageTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: 'Generate an image using local Stable Diffusion WebUI or Pollinations AI and save it to disk.',
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
          description: 'Sampling steps for local SD image generation (default 20).',
        },
        provider: {
          type: 'string',
          description: 'Image generation engine: auto (local SD with Pollinations fallback), sd-webui, or pollinations.',
        },
        output_path: {
          type: 'string',
          description: 'Relative or absolute file path to save the generated PNG image (default ./assets/images/img_<timestamp>.png).',
        },
      },
      required: ['prompt'],
    },
  },
};
