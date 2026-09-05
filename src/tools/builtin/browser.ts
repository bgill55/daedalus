import path from 'path';
import fs from 'fs';
import { ToolContext, ToolResult } from '../../types.js';

export function resolveChromePath(): string | null {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ...(process.env.LOCALAPPDATA ? [`${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`] : []),
    ...(process.env.ProgramW6432 ? [`${process.env.ProgramW6432}\\Google\\Chrome\\Application\\chrome.exe`] : []),
    `${process.env.USERPROFILE || ''}\\scoop\\apps\\googlechrome\\current\\chrome.exe`,
    `${process.env.USERPROFILE || ''}\\AppData\\Local\\Programs\\Opera\\opera.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
  ];

  return chromePaths.find(p => fs.existsSync(p)) || null;
}

export interface BrowsePageArgs {
  url: string;
  action?: 'navigate' | 'click' | 'type' | 'eval' | 'extract';
  selector?: string;
  text?: string;
  script?: string;
  screenshot?: boolean;
  wait_for?: string;
  timeout?: number;
  width?: number;
  height?: number;
}

export async function browsePage(
  args: BrowsePageArgs,
  _context: ToolContext
): Promise<ToolResult> {
  const action = args.action ?? 'navigate';
  const timeoutMs = (args.timeout ?? 20) * 1000;

  let browser: import('puppeteer-core').Browser | null = null;

  try {
    let puppeteer: typeof import('puppeteer-core').default;
    try {
      puppeteer = (await import('puppeteer-core')).default;
    } catch {
      return {
        toolCallId: '',
        name: 'browse_page',
        success: false,
        content: '',
        error: 'puppeteer-core is not installed. Run: npm install puppeteer-core',
      };
    }

    const executablePath = resolveChromePath();
    if (!executablePath) {
      return {
        toolCallId: '',
        name: 'browse_page',
        success: false,
        content: '',
        error: 'Chrome / Chromium not found. Set CHROME_PATH environment variable or install Google Chrome.',
      };
    }

    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: args.width ?? 1280, height: args.height ?? 900 });

    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error' || type === 'warn') {
        consoleLogs.push(`[${type.toUpperCase()}] ${text}`);
      }
    });

    page.on('pageerror', (err: Error | unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      pageErrors.push(`[UNCAUGHT EXCEPTION] ${msg}`);
    });

    // Navigate to URL
    await page.goto(args.url, {
      waitUntil: 'networkidle2',
      timeout: timeoutMs,
    });

    if (args.wait_for) {
      await page.waitForSelector(args.wait_for, { timeout: 8000 }).catch(() => {});
    }

    let actionResultText = '';

    if (action === 'click') {
      if (!args.selector) {
        return {
          toolCallId: '',
          name: 'browse_page',
          success: false,
          content: '',
          error: 'Missing required "selector" parameter for "click" action.',
        };
      }
      await page.waitForSelector(args.selector, { timeout: 5000 });
      await page.click(args.selector);
      await new Promise(r => setTimeout(r, 1000));
      actionResultText = `Successfully clicked selector: ${args.selector}`;
    } else if (action === 'type') {
      if (!args.selector || args.text === undefined) {
        return {
          toolCallId: '',
          name: 'browse_page',
          success: false,
          content: '',
          error: 'Missing required "selector" or "text" parameter for "type" action.',
        };
      }
      await page.waitForSelector(args.selector, { timeout: 5000 });
      await page.type(args.selector, args.text);
      actionResultText = `Successfully typed text into selector: ${args.selector}`;
    } else if (action === 'eval') {
      if (!args.script) {
        return {
          toolCallId: '',
          name: 'browse_page',
          success: false,
          content: '',
          error: 'Missing required "script" parameter for "eval" action.',
        };
      }
      const evalOutput = await page.evaluate(args.script);
      actionResultText = `Evaluation Result:\n${typeof evalOutput === 'object' ? JSON.stringify(evalOutput, null, 2) : String(evalOutput)}`;
    } else if (action === 'extract') {
      const selector = args.selector || 'body';
      const extracted = await page.evaluate(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          return el ? (el.textContent || '').trim() : null;
        })()
      `) as string | null;

      if (extracted === null) {
        return {
          toolCallId: '',
          name: 'browse_page',
          success: false,
          content: '',
          error: `Selector not found: ${selector}`,
        };
      }
      actionResultText = `Extracted Text from "${selector}":\n${extracted}`;
    }

    // Extract rendered page title and clean text
    const pageTitle = await page.title();
    const currentUrl = page.url();

    let renderedText = '';
    if (action === 'navigate') {
      renderedText = await page.evaluate(`
        (() => {
          const clone = document.body.cloneNode(true);
          const removeTags = clone.querySelectorAll('script, style, noscript, svg, iframe');
          removeTags.forEach(node => node.remove());
          return (clone.innerText || clone.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
        })()
      `) as string;
    }

    // Optional Screenshot capture
    let screenshotInfo: { savedPath: string; base64: string } | null = null;
    if (args.screenshot) {
      const screenshotBuffer = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
      const screenshotDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.daedalus', 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      const filename = `browse_${Date.now()}.png`;
      const outputPath = path.join(screenshotDir, filename);
      fs.writeFileSync(outputPath, screenshotBuffer);
      screenshotInfo = {
        savedPath: outputPath,
        base64: screenshotBuffer.toString('base64'),
      };
    }

    const sections: string[] = [];
    sections.push(`Title: ${pageTitle}`);
    sections.push(`URL: ${currentUrl}`);
    sections.push(`Action: ${action.toUpperCase()}`);

    if (actionResultText) {
      sections.push(`\n--- Action Result ---\n${actionResultText}`);
    }

    if (consoleLogs.length > 0) {
      sections.push(`\n--- Console Warnings / Errors (${consoleLogs.length}) ---\n${consoleLogs.slice(0, 10).join('\n')}`);
    }

    if (pageErrors.length > 0) {
      sections.push(`\n--- Uncaught Page Errors (${pageErrors.length}) ---\n${pageErrors.join('\n')}`);
    }

    if (renderedText) {
      const maxLen = 40000;
      const truncated = renderedText.length > maxLen ? renderedText.slice(0, maxLen) + '\n\n... [DOM text truncated]' : renderedText;
      sections.push(`\n--- Rendered Page Content ---\n${truncated}`);
    }

    if (screenshotInfo) {
      sections.push(`\n[Screenshot saved to ${screenshotInfo.savedPath}]`);
    }

    return {
      toolCallId: '',
      name: 'browse_page',
      success: true,
      content: sections.join('\n'),
    };
  } catch (err) {
    return {
      toolCallId: '',
      name: 'browse_page',
      success: false,
      content: '',
      error: `Browser automation failed: ${(err instanceof Error ? err.message : String(err))}`,
    };
  } finally {
    if (browser) {
      await browser.close().catch((err: unknown) => console.error('Browser close error:', (err as Error).message));
    }
  }
}
