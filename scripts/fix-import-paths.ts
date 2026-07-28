import fs from 'fs';

for (const file of ['context.ts', 'agents.ts', 'dev.ts']) {
  let content = fs.readFileSync(`src/commands/${file}`, 'utf-8');
  content = content.replace(/from '\.\/((?!types\.)[^']+)'/g, "from '../$1'");
  content = content.replace(/import\('\.\/((?!types\.)[^']+)'\)/g, "import('../$1')");
  fs.writeFileSync(`src/commands/${file}`, content, 'utf-8');
  console.log(`Fixed paths in ${file}`);
}
