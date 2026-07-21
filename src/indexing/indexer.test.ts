import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initIndexDb } from './fts.js';
import { collectFiles, parseTypeScript, parsePython, parseGo, parseRust, parseJava, parseCpp, parseCSharp, parsePhp, parseRuby, parseElixir, indexCodebase } from './indexer.js';

describe('Indexer - collectFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-idx-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collects .ts and .js files recursively', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), '');
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sub', 'c.tsx'), '');
    fs.writeFileSync(path.join(tmpDir, 'sub', 'd.py'), '');

    const files = collectFiles(tmpDir, tmpDir, new Set(['node_modules', 'dist']), new Set(['.ts', '.tsx', '.js']));
    const names = files.map(f => path.relative(tmpDir, f)).sort();
    expect(names).toEqual(['a.ts', 'b.js', path.join('sub', 'c.tsx')]);
  });

  it('excludes specified directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'bad.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'good.ts'), '');

    const files = collectFiles(tmpDir, tmpDir, new Set(['node_modules']), new Set(['.ts']));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('node_modules');
  });

  it('returns empty for directory with no matching extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'file.py'), '');
    const files = collectFiles(tmpDir, tmpDir, new Set(), new Set(['.ts']));
    expect(files).toEqual([]);
  });

});

describe('Indexer - parseTypeScript', () => {
  const projectHash = 'testhash';

  it('parses class definitions', () => {
    const content = 'export class MyService {\n  doStuff() {}\n}\n';
    const { symbols } = parseTypeScript(content, 'src/service.ts', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('MyService');
    expect(symbols[0].kind).toBe('class');
  });

  it('parses function definitions', () => {
    const content = 'export function greet(name: string): string {\n  return `Hello ${name}`;\n}\n';
    const { symbols } = parseTypeScript(content, 'src/greet.ts', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('greet');
    expect(symbols[0].kind).toBe('function');
  });

  it('parses interface definitions', () => {
    const content = 'export interface User {\n  name: string;\n}\n';
    const { symbols } = parseTypeScript(content, 'src/types.ts', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('User');
    expect(symbols[0].kind).toBe('interface');
  });

  it('parses type definitions', () => {
    const content = 'export type Status = "active" | "inactive";\n';
    const { symbols } = parseTypeScript(content, 'src/types.ts', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('type');
  });

  it('parses arrow function const definitions', () => {
    const content = 'export const handler = async (req: Request): Promise<Response> => {\n  return new Response("ok");\n}\n';
    const { symbols } = parseTypeScript(content, 'src/handler.ts', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('function');
    expect(symbols[0].name).toBe('handler');
  });

  it('extracts references (function calls)', () => {
    const content = 'function caller() {\n  helper();\n  another();\n}\n';
    const { references } = parseTypeScript(content, 'src/test.ts', projectHash);
    expect(references.length).toBeGreaterThan(0);
    expect(references[0].caller_name).toBe('caller');
  });

  it('handles empty content', () => {
    const { symbols, references } = parseTypeScript('', 'empty.ts', projectHash);
    expect(symbols).toEqual([]);
    expect(references).toEqual([]);
  });

});

describe('Indexer - parsePython', () => {
  const projectHash = 'testhash';

  it('parses class definitions', () => {
    const content = 'class MyClass:\n  pass\n';
    const { symbols } = parsePython(content, 'src/mod.py', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('MyClass');
  });

  it('parses function definitions', () => {
    const content = 'def my_function():\n    return 42\n';
    const { symbols } = parsePython(content, 'src/fn.py', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('my_function');
  });

  it('skips comments and empty lines', () => {
    const content = '# comment\n\ndef real():\n    pass\n';
    const { symbols } = parsePython(content, 'src/fn.py', projectHash);
    expect(symbols).toHaveLength(1);
  });

});

describe('Indexer - parseGo', () => {
  const projectHash = 'testhash';

  it('parses struct definitions', () => {
    const content = 'type Config struct {\n  Name string\n}\n';
    const { symbols } = parseGo(content, 'src/config.go', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('struct');
  });

  it('parses function definitions', () => {
    const content = 'func Hello() string {\n  return "hello"\n}\n';
    const { symbols } = parseGo(content, 'src/hello.go', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('Hello');
  });

  it('parses method definitions', () => {
    const content = 'func (s *Service) DoStuff() error {\n  return nil\n}\n';
    const { symbols } = parseGo(content, 'src/service.go', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('method');
  });

});

describe('Indexer - parseRust', () => {
  const projectHash = 'testhash';

  it('parses struct definitions', () => {
    const content = 'pub struct Config {\n  pub name: String,\n}\n';
    const { symbols } = parseRust(content, 'src/config.rs', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('struct');
  });

  it('parses enum definitions', () => {
    const content = 'pub enum Status {\n  Active,\n  Inactive,\n}\n';
    const { symbols } = parseRust(content, 'src/status.rs', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('enum');
  });

  it('parses function definitions', () => {
    const content = 'pub fn greet(name: &str) -> String {\n  format!("Hello {}", name)\n}\n';
    const { symbols } = parseRust(content, 'src/greet.rs', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('greet');
  });

  it('parses trait definitions', () => {
    const content = 'pub trait Runnable {\n}\n';
    const { symbols } = parseRust(content, 'src/trait.rs', projectHash);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('trait');
  });

});

describe('Indexer - parseJava', () => {
  const projectHash = 'testhash';

  it('parses class and method definitions', () => {
    const content = 'public class UserService {\n  public void createUser(String name) {}\n}\n';
    const { symbols } = parseJava(content, 'UserService.java', projectHash);
    expect(symbols).toHaveLength(2);
    expect(symbols[0].name).toBe('UserService');
    expect(symbols[0].kind).toBe('class');
    expect(symbols[1].name).toBe('createUser');
    expect(symbols[1].kind).toBe('method');
  });
});

describe('Indexer - parseCpp', () => {
  const projectHash = 'testhash';

  it('parses struct and function definitions', () => {
    const content = 'struct Node {\n};\nint main() {\n  return 0;\n}\n';
    const { symbols } = parseCpp(content, 'main.cpp', projectHash);
    expect(symbols).toHaveLength(2);
    expect(symbols[0].kind).toBe('struct');
    expect(symbols[1].kind).toBe('function');
  });
});

describe('Indexer - parseCSharp', () => {
  const projectHash = 'testhash';

  it('parses interface and method definitions', () => {
    const content = 'public interface IRepository {\n  Task SaveAsync();\n}\n';
    const { symbols } = parseCSharp(content, 'IRepository.cs', projectHash);
    expect(symbols).toHaveLength(2);
    expect(symbols[0].kind).toBe('interface');
    expect(symbols[1].kind).toBe('method');
  });
});

describe('Indexer - parsePhp', () => {
  const projectHash = 'testhash';

  it('parses class and function definitions', () => {
    const content = 'class Controller {\n  public function index() {}\n}\n';
    const { symbols } = parsePhp(content, 'Controller.php', projectHash);
    expect(symbols).toHaveLength(2);
    expect(symbols[0].kind).toBe('class');
    expect(symbols[1].kind).toBe('function');
  });
});

describe('Indexer - parseRuby', () => {
  const projectHash = 'testhash';

  it('parses module and method definitions', () => {
    const content = 'module Helper\n  def format_text\n  end\nend\n';
    const { symbols } = parseRuby(content, 'helper.rb', projectHash);
    expect(symbols).toHaveLength(2);
    expect(symbols[0].kind).toBe('module');
    expect(symbols[1].kind).toBe('method');
  });
});

describe('Indexer - parseElixir', () => {
  const projectHash = 'testhash';

  it('parses defmodule and def functions', () => {
    const content = 'defmodule MyApp.User do\n  def find_user(id) do\n  end\nend\n';
    const { symbols } = parseElixir(content, 'user.ex', projectHash);
    expect(symbols).toHaveLength(2);
    expect(symbols[0].kind).toBe('module');
    expect(symbols[1].kind).toBe('function');
  });
});

describe('Indexer - indexCodebase integration', () => {
  let tmpDir: string;
  let db: Database.Database;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-idx-int-'));
    dbPath = path.join(tmpDir, 'index.sqlite');
    db = initIndexDb(dbPath);

    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export function hello(name: string): string {\n  return `Hi ${name}`;\n}\n');
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sub', 'utils.ts'), 'export const add = (a: number, b: number): number => {\n  return a + b;\n}\n');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('indexes codebase and returns results', async () => {
    const result = await indexCodebase(db, tmpDir, 'proj1');
    expect(result.totalFiles).toBe(2);
    expect(result.indexedFiles).toBe(2);
    expect(result.skippedFiles).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('skips unchanged files on second run', async () => {
    await indexCodebase(db, tmpDir, 'proj1');
    const result = await indexCodebase(db, tmpDir, 'proj1');
    expect(result.skippedFiles).toBe(2);
    expect(result.indexedFiles).toBe(0);
  });

  it('re-indexes changed files', async () => {
    await indexCodebase(db, tmpDir, 'proj1');
    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export function hello(name: string): string {\n  return `Hey ${name}`;\n}\n');
    const result = await indexCodebase(db, tmpDir, 'proj1');
    expect(result.indexedFiles).toBe(1);
    expect(result.skippedFiles).toBe(1);
  });

});
