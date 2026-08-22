import pc from 'picocolors';
import { brand, rule } from './ui/theme.js';

const LOGO_ROWS = [
  ' ██████╗   █████╗  ███████╗ ██████╗   █████╗  ██╗     ██╗   ██╗ ███████╗ ',
  ' ██╔══██╗ ██╔══██╗ ██╔════╝ ██╔══██╗ ██╔══██╗ ██║     ██║   ██║ ██╔════╝ ',
  ' ██║  ██║ ███████║ █████╗   ██║  ██║ ███████║ ██║     ██║   ██║ ███████╗ ',
  ' ██║  ██║ ██╔══██║ ██╔══╝   ██║  ██║ ██╔══██║ ██║     ██║   ██║ ╚════██║ ',
  ' ██████╔╝ ██║  ██║ ███████╗ ██████╔╝ ██║  ██║ ███████╗╚██████╔╝ ███████║ ',
  ' ╚═════╝  ╚═╝  ╚═╝ ╚══════╝ ╚═════╝  ╚═╝  ╚═╝ ╚══════╝ ╚═════╝  ╚══════╝ ',
];

const W = 76;

function box(inner: string, borderColor: (s: string) => string): string {
  return borderColor('║') + inner + borderColor('║');
}

function hRule(l: string, r: string, fill: string, len: number, color: (s: string) => string): string {
  return color(l + fill.repeat(len) + r);
}

function centred(text: string, width: number, color: (s: string) => string): string {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(left) + color(text) + ' '.repeat(right);
}

export function printBanner(version: string): void {
  const cyan  = brand;
  const white = pc.white.bind(pc);
  const bold  = pc.bold.bind(pc);
  const dim   = pc.dim.bind(pc);

  console.log(hRule('╔', '╗', '═', W, cyan));
  console.log(box(' '.repeat(W), cyan));

  LOGO_ROWS.forEach((row, i) => {
    const mid = Math.floor(row.length * (0.4 + i * 0.04));
    const left  = cyan(row.slice(0, mid));
    const right = white(row.slice(mid));
    const inner = left + right;
    const visLen = row.length;
    const padded = inner + ' '.repeat(Math.max(0, W - visLen));
    console.log(box(padded, cyan));
  });

  console.log(box(' '.repeat(W), cyan));

  const tagline = 'local-first  ·  embedded router  ·  multi-agent  ·  not sentient';
  console.log(box(centred(tagline, W, dim), cyan));

  console.log(hRule('╚', '╝', '═', W, cyan));

  const badge    = `  v${version}`;
  const author   = `bgill55_dev  `;
  const divider  = ` · `;
  console.log('');
  console.log(
    '  ' +
    pc.bgCyan(pc.black(bold(` DAEDALUS `))) +
    pc.bgBlack(brand(bold(badge))) +
    pc.bgBlack(dim(divider)) +
    pc.bgBlack(pc.white(author))
  );
  console.log('');
}

export function printConfigInfo(
  enabledCount: number,
  strategy: string,
  configPath: string,
): void {
  const contentLine = `strategy  ${strategy}    models  ${enabledCount}   config  ${configPath}`;
  const top = pc.dim('  ┌─ ') + rule('router') + pc.dim(' ' + '─'.repeat(Math.max(0, contentLine.length - 7)) + '┐');
  const mid = pc.dim('  │ ') + pc.white(contentLine) + pc.dim(' │');
  const bot = pc.dim('  └' + '─'.repeat(contentLine.length + 2) + '┘');

  console.log(top);
  console.log(mid);
  console.log(bot);
  console.log('');

  console.log(`  ${pc.dim('Type')} ${rule('?')} ${pc.dim('for commands  ·  ')} ${rule('https://discord.gg/74pCA68KGK')} ${pc.dim('(Discord)')} ${pc.dim('  ·  ')} ${rule('https://github.com/bgill55/daedalus')} ${pc.dim('(Star us!)')}`);
  console.log('');
}
