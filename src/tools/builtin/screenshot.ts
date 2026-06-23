import path from 'path';
import fs from 'fs';
import { ToolContext, ToolResult } from '../../types.js';

function formatError(error: string): ToolResult {
  return { toolCallId: '', name: 'screenshot_page', success: false, content: '', error };
}

export async function screenshotPage(
  args: { url: string; selector?: string; width?: number; height?: number },
  _context: ToolContext
): Promise<ToolResult> {
  let browser: any = null;
  try {
    let puppeteer: any;
    try {
      puppeteer = (await import('puppeteer-core')).default;
    } catch {
      return formatError('puppeteer-core is not installed. Run: npm install -g puppeteer-core');
    }

    let executablePath = process.env.CHROME_PATH;
    if (!executablePath) {
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ...(process.env.LOCALAPPDATA ? [`${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`] : []),
        ...(process.env.ProgramW6432 ? [`${process.env.ProgramW6432}\\Google\\Chrome\\Application\\chrome.exe`] : []),
        `${process.env.USERPROFILE || ''}\\scoop\\apps\\googlechrome\\current\\chrome.exe`,
        `${process.env.USERPROFILE || ''}\\AppData\\Local\\Programs\\Opera\\opera.exe`,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
      ];
      executablePath = chromePaths.find(p => fs.existsSync(p));
    }
    if (!executablePath) {
      return formatError(
        'Chrome not found. Set CHROME_PATH env var or install Google Chrome. ' +
        'Checked: environment variable and common install paths'
      );
    }

    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: args.width ?? 1280, height: args.height ?? 900 });
    await page.goto(args.url, { waitUntil: 'networkidle2', timeout: 15000 });

    let screenshotBuffer: Buffer;
    if (args.selector) {
      const el = await page.$(args.selector);
      if (!el) return formatError(`Selector not found: ${args.selector}`);
      screenshotBuffer = Buffer.from(await el.screenshot({ type: 'png' }));
    } else {
      screenshotBuffer = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
    }

    const screenshotDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.daedalus', 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const filename = `screenshot_${Date.now()}.png`;
    const outputPath = path.join(screenshotDir, filename);
    fs.writeFileSync(outputPath, screenshotBuffer);

    const base64 = screenshotBuffer.toString('base64');

    return {
      toolCallId: '',
      name: 'screenshot_page',
      success: true,
      content: JSON.stringify({
        type: 'vision',
        url: args.url,
        selector: args.selector ?? null,
        savedPath: outputPath,
        base64,
        mimeType: 'image/png',
      }),
    };
  } catch (err: any) {
    return formatError(`Screenshot failed: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch((err: unknown) => console.error('browser close error:', (err as Error).message));
  }
}
