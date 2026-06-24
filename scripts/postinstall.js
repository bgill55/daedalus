import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const configDir = join(homedir(), '.daedalus');

if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
  console.log('Created ~/.daedalus config directory');
}
