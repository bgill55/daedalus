import fs from 'fs';
import path from 'path';
import os from 'os';
import { getProjectHash } from '../../project-hash.js';

export interface ProjectConfig {
  projectHash: string;
  projectRoot: string;
  testCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
  devCommand?: string;
  autoRunTests?: boolean;
  enableGitAutoCommit?: boolean;
  updated_at: number;
}

function getGlobalConfigDir(): string {
  return path.join(os.homedir(), '.daedalus', 'config');
}

function getGlobalConfigPath(projectRoot: string): string {
  const projectHash = getProjectHash(projectRoot);
  return path.join(getGlobalConfigDir(), `${projectHash}.json`);
}

function getLocalConfigPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), '.daedalusrc');
}

function getDefaultConfig(projectRoot: string): ProjectConfig {
  return {
    projectHash: getProjectHash(projectRoot),
    projectRoot: path.resolve(projectRoot),
    testCommand: undefined,
    buildCommand: undefined,
    lintCommand: undefined,
    devCommand: undefined,
    autoRunTests: true,
    enableGitAutoCommit: false,
    updated_at: Date.now(),
  };
}

export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const defaults = getDefaultConfig(projectRoot);

  const localPath = getLocalConfigPath(projectRoot);
  if (fs.existsSync(localPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(localPath, 'utf8')) as ProjectConfig;
      return { ...defaults, ...data, projectRoot: path.resolve(projectRoot) };
    } catch {
      // fall through to global
    }
  }

  const globalPath = getGlobalConfigPath(projectRoot);
  const dir = path.dirname(globalPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(globalPath)) {
    return defaults;
  }

  try {
    const data = JSON.parse(fs.readFileSync(globalPath, 'utf8')) as ProjectConfig;
    return { ...defaults, ...data };
  } catch {
    return defaults;
  }
}

export function saveProjectConfig(config: ProjectConfig, local?: boolean): void {
  const resolvedRoot = path.resolve(config.projectRoot);

  if (local) {
    const localPath = getLocalConfigPath(resolvedRoot);
    config.updated_at = Date.now();
    fs.writeFileSync(localPath, JSON.stringify(config, null, 2), 'utf8');
    return;
  }

  const globalPath = getGlobalConfigPath(resolvedRoot);
  const dir = path.dirname(globalPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  config.updated_at = Date.now();
  fs.writeFileSync(globalPath, JSON.stringify(config, null, 2), 'utf8');
}

export function getTestCommand(projectRoot: string): string | undefined {
  const config = loadProjectConfig(projectRoot);
  return config.testCommand;
}

export function setTestCommand(projectRoot: string, command: string, local?: boolean): void {
  const config = loadProjectConfig(projectRoot);
  config.testCommand = command;
  saveProjectConfig(config, local);
}

export function getProjectConfig(projectRoot: string): ProjectConfig {
  return loadProjectConfig(projectRoot);
}

export function hasLocalConfig(projectRoot: string): boolean {
  return fs.existsSync(getLocalConfigPath(projectRoot));
}
