import fs from 'fs';
import path from 'path';

export interface DaedalusRecipe {
  name: string;
  description: string;
  role?: string;
  skills?: string[];
  tools?: string[];
  prompt: string;
  filePath: string;
}

export function parseSimpleYaml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split('\n');
  let currentKey = '';
  let inMultiline = false;
  let multilineBuffer: string[] = [];

  for (const line of lines) {
    if (inMultiline) {
      if (line.startsWith('  ') || line.startsWith('\t') || line.trim() === '') {
        multilineBuffer.push(line.replace(/^\s{2}/, ''));
        continue;
      } else {
        result[currentKey] = multilineBuffer.join('\n').trim();
        inMultiline = false;
        multilineBuffer = [];
      }
    }

    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      currentKey = key;

      if (val === '|' || val === '>') {
        inMultiline = true;
        multilineBuffer = [];
      } else if (val.startsWith('[') && val.endsWith(']')) {
        try {
          result[key] = JSON.parse(val);
        } catch {
          result[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        }
      } else {
        result[key] = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  if (inMultiline && currentKey) {
    result[currentKey] = multilineBuffer.join('\n').trim();
  }

  return result;
}

export function loadRecipeFromFile(filePath: string): DaedalusRecipe | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    let parsed: Record<string, any>;
    if (filePath.endsWith('.json')) {
      parsed = JSON.parse(raw);
    } else {
      parsed = parseSimpleYaml(raw);
    }

    if (!parsed.name || !parsed.prompt) return null;

    return {
      name: String(parsed.name).trim(),
      description: String(parsed.description || '').trim(),
      role: parsed.role ? String(parsed.role).trim() : undefined,
      skills: Array.isArray(parsed.skills) ? parsed.skills.map(String) : undefined,
      tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : undefined,
      prompt: String(parsed.prompt).trim(),
      filePath,
    };
  } catch {
    return null;
  }
}

export function listRecipes(projectRoot: string, configDir: string): DaedalusRecipe[] {
  const recipes: DaedalusRecipe[] = [];
  const searchDirs = [
    path.join(projectRoot, '.daedalus', 'recipes'),
    path.join(configDir, 'recipes'),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')) {
          const rec = loadRecipeFromFile(path.join(dir, file));
          if (rec && !recipes.some(r => r.name.toLowerCase() === rec.name.toLowerCase())) {
            recipes.push(rec);
          }
        }
      }
    } catch { /* ignore dir errors */ }
  }

  return recipes;
}
