import * as fs from 'fs';
import * as path from 'path';

export function detectProjectStack(projectRoot: string): string {
  const parts: string[] = [];

  const pkgJsonPath = path.join(projectRoot, 'package.json');
  const tsConfigPath = path.join(projectRoot, 'tsconfig.json');

  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      const frameworks: string[] = [];
      if (deps['react']) frameworks.push('React');
      if (deps['next']) frameworks.push('Next.js');
      if (deps['vue']) frameworks.push('Vue');
      if (deps['svelte']) frameworks.push('Svelte');
      if (deps['angular']) frameworks.push('Angular');
      if (deps['express']) frameworks.push('Express');
      if (deps['nest']) frameworks.push('NestJS');
      if (deps['wrangler']) frameworks.push('Cloudflare Pages/Workers (Serverless)');
      if (deps['vite']) frameworks.push('Vite');
      if (deps['tailwindcss']) frameworks.push('TailwindCSS');

      const frameworkStr = frameworks.length > 0 ? frameworks.join(', ') : 'Vanilla JS';
      parts.push(`Language/Environment: JavaScript/Node.js (${fs.existsSync(tsConfigPath) ? 'TypeScript' : 'ESM/CommonJS'})`);
      parts.push(`Frameworks/Libraries: ${frameworkStr}`);
      if (pkg.scripts) {
        parts.push(`Available Scripts: ${Object.keys(pkg.scripts).join(', ')}`);
      }
    } catch {
      parts.push('Language/Environment: JavaScript/Node.js (unparsed package.json)');
    }
  } else {
    // Check python
    if (fs.existsSync(path.join(projectRoot, 'requirements.txt')) || fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {
      parts.push('Language/Environment: Python');
    } else if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
      parts.push('Language/Environment: Rust (Cargo)');
    } else if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
      parts.push('Language/Environment: Go');
    }
  }

  // Check HTML/CSS vanilla indicator
  const indexHtmlPath = path.join(projectRoot, 'index.html');
  if (fs.existsSync(indexHtmlPath) && parts.length === 0) {
    parts.push('Language/Environment: Frontend web page (HTML/CSS)');
    parts.push('Frameworks/Libraries: None (Vanilla HTML5 / CSS3 / JavaScript)');
  }

  if (parts.length === 0) {
    return '';
  }

  return `\n--- DETECTED PROJECT TECH STACK ---\n${parts.map(p => `- ${p}`).join('\n')}\n-----------------------------------\n`;
}
