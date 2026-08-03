import { z } from 'zod';
import { ConfigSchema, type DaedalusConfig } from './index.js';
import * as fs from 'fs';

export class ConfigValidationError extends Error {
  constructor(message: string, public path?: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig(cfg: unknown): DaedalusConfig {
  if (!cfg || typeof cfg !== 'object') {
    throw new ConfigValidationError('Config must be a non-null object');
  }

  try {
    return ConfigSchema.parse(cfg);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const messages = err.errors.map(e => {
        const p = e.path.join('.');
        return `${p || 'root'}: ${e.message}`;
      });
      throw new ConfigValidationError(messages.join('; '));
    }
    throw new ConfigValidationError('Unknown validation error');
  }
}

export function validateConfigFile(configPath: string): DaedalusConfig {
  if (!fs.existsSync(configPath)) {
    throw new ConfigValidationError('Config file does not exist', configPath);
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    return validateConfig(parsed);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ConfigValidationError('Invalid JSON in config file', configPath);
    }
    if (err instanceof ConfigValidationError) {
      throw err;
    }
    throw new ConfigValidationError('Failed to read config file', configPath);
  }
}
