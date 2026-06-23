import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function getClipboardText(): string {
  try {
    if (process.platform === 'win32') {
      return execSync('powershell -noprofile -command "Get-Clipboard"', { timeout: 5000, encoding: 'utf8' }).trim().slice(0, 100_000);
    } else if (process.platform === 'darwin') {
      return execSync('pbpaste', { timeout: 5000, encoding: 'utf8' }).trim().slice(0, 100_000);
    } else {
      return execSync('xclip -o -selection clipboard', { timeout: 5000, encoding: 'utf8' }).trim().slice(0, 100_000);
    }
  } catch {
    return '';
  }
}

export function getClipboardImage(tempDir: string): string | null {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const outPath = path.join(tempDir, `paste-${timestamp}-${random}.png`);
  try {
    if (process.platform === 'win32') {
      const safePath = outPath.replace(/[^a-zA-Z0-9_:.\\-]/g, '');
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $img.Save('${safePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output 'ok'
}`;
      const scriptPath = path.join(tempDir, `clip-img-${timestamp}-${random}.ps1`);
      fs.writeFileSync(scriptPath, psScript, 'utf8');
      const result = execSync(`powershell -noprofile -ExecutionPolicy Bypass -File "${scriptPath}"`, { timeout: 8000, encoding: 'utf8' }).trim();
      try { fs.unlinkSync(scriptPath); } catch { /* ignored */ }
      if (result === 'ok' && fs.existsSync(outPath)) return outPath;
    } else if (process.platform === 'darwin') {
      execSync(`pngpaste "${outPath}"`, { timeout: 5000 });
      if (fs.existsSync(outPath)) return outPath;
    } else {
      const imgData = execSync(`xclip -selection clipboard -t image/png -o`, { timeout: 5000, encoding: 'buffer' }) as Buffer;
      if (imgData && imgData.length > 0) {
        fs.writeFileSync(outPath, imgData);
        return outPath;
      }
    }
  } catch {
    // No image in clipboard
  }
  return null;
}
