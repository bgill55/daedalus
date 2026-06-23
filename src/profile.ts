import fs from 'fs';
import path from 'path';
import os from 'os';

export interface UserProfile {
  name: string;
  bio: string;
  style: string;
  updatedAt: number;
}

const DEFAULT_PROFILE: UserProfile = {
  name: '',
  bio: '',
  style: '',
  updatedAt: 0,
};

function profilePath(): string {
  if (process.env.DAEDALUS_PROFILE_PATH) return process.env.DAEDALUS_PROFILE_PATH;
  return path.join(os.homedir(), '.daedalus', 'profile.json');
}

export function loadProfile(): UserProfile {
  const p = profilePath();
  try {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { ...DEFAULT_PROFILE, ...data };
    }
  } catch { /* ignored */ }
  return { ...DEFAULT_PROFILE };
}

export function saveProfile(profile: UserProfile): void {
  const p = profilePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  profile.updatedAt = Date.now();
  fs.writeFileSync(p, JSON.stringify(profile, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    try { fs.chmodSync(p, 0o600); } catch { /* ignored */ }
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
