// Project configuration for Daedalus
// Stores per-project settings like test commands, build commands, etc.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

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

function getConfigDir(): string {
  return path.join(os.homedir(), '.daedalus', 'config');
}

function getConfigPath(projectRoot: string): string {
  const projectHash = crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
  return path.join(getConfigDir(), `${projectHash}.json`);
}

function getDefaultConfig(projectRoot: string): ProjectConfig {
  return {
    projectHash: crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 12),
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
  const configPath = getConfigPath(projectRoot);
  const dir = path.dirname(configPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    return getDefaultConfig(projectRoot);
  }

  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ProjectConfig;
    // Merge with defaults to ensure all fields exist
    return { ...getDefaultConfig(projectRoot), ...data };
  } catch {
    return getDefaultConfig(projectRoot);
  }
}

export function saveProjectConfig(config: ProjectConfig): void {
  const configPath = getConfigPath(config.projectRoot);
  const dir = path.dirname(configPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  config.updated_at = Date.now();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function getTestCommand(projectRoot: string): string | undefined {
  const config = loadProjectConfig(projectRoot);
  return config.testCommand;
}

export function setTestCommand(projectRoot: string, command: string): void {
  const config = loadProjectConfig(projectRoot);
  config.testCommand = command;
  saveProjectConfig(config);
}

export function getProjectConfig(projectRoot: string): ProjectConfig {
  return loadProjectConfig(projectRoot);
}