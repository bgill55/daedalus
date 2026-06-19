import fs from 'fs';
import path from 'path';
import os from 'os';

export interface UserProfile {
  name: string;
  bio: string;
  style: string;
  updatedAt: number;
}

const PROFILE_PATH = path.join(os.homedir(), '.daedalus', 'profile.json');

const DEFAULT_PROFILE: UserProfile = {
  name: '',
  bio: '',
  style: '',
  updatedAt: 0,
};

export function loadProfile(): UserProfile {
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
      return { ...DEFAULT_PROFILE, ...data };
    }
  } catch {
    // corrupted file, return default
  }
  return { ...DEFAULT_PROFILE };
}

export function saveProfile(profile: UserProfile): void {
  const dir = path.dirname(PROFILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  profile.updatedAt = Date.now();
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    try { fs.chmodSync(PROFILE_PATH, 0o600); } catch {}
  }
}

export function getProfilePrompt(profile: UserProfile): string {
  if (!profile.name && !profile.bio && !profile.style) return '';
  let prompt = '\n--- USER PROFILE ---\n';
  if (profile.name) prompt += `Name: ${profile.name}\n`;
  if (profile.bio) prompt += `About: ${profile.bio}\n`;
  if (profile.style) prompt += `Coding style / preferences: ${profile.style}\n`;
  prompt += '----------------------\n';
  return prompt;
}
