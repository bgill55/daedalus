import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { commandsList } from './commands.js';
import { ConfigSchema } from './config/index.js';

function extractSchemaPaths(schema: any, prefix = ''): string[] {
  const paths: string[] = [];
  if (!schema) return paths;

  if (prefix.split('.').length >= 2) {
    return paths;
  }

  if (schema._def && schema._def.shape) {
    const shape = schema._def.shape();
    for (const key of Object.keys(shape)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      paths.push(currentPath);
      paths.push(...extractSchemaPaths(shape[key], currentPath));
    }
  } else if (schema._def && schema._def.schema) {
    paths.push(...extractSchemaPaths(schema._def.schema, prefix));
  } else if (schema._def && schema._def.valueType) {
    paths.push(...extractSchemaPaths(schema._def.valueType, prefix));
  } else if (schema._def && schema._def.type) {
    paths.push(...extractSchemaPaths(schema._def.type, prefix));
  } else if (schema._def && schema._def.innerType) {
    paths.push(...extractSchemaPaths(schema._def.innerType, prefix));
  }

  return paths;
}

describe('Documentation Sync Verification', () => {
  const projectRoot = process.cwd();
  const mdFiles = [
    path.join(projectRoot, 'README.md'),
    ...fs.readdirSync(path.join(projectRoot, 'docs'))
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(projectRoot, 'docs', f))
  ];

  const allMdContent = mdFiles
    .map(filePath => fs.readFileSync(filePath, 'utf8'))
    .join('\n');

  it('verifies all CLI commands are documented', () => {
    for (const cmd of commandsList) {
      const cmdName = cmd.name;
      expect(allMdContent).toContain(cmdName);
    }
  });

  it('verifies all config schema keys are documented', () => {
    const configPaths = extractSchemaPaths(ConfigSchema);
    for (const p of configPaths) {
      expect(allMdContent).toContain(p);
    }
  });
});
