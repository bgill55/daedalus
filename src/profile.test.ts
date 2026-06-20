import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEMP = process.env.TEMP || process.env.TMPDIR || '/tmp';
const TEST_HOME = fs.mkdtempSync(path.join(TEMP, 'daedalus-profile-test-'));

process.env.DAEDALUS_PROFILE_PATH = path.join(TEST_HOME, '.daedalus', 'profile.json');

const { loadProfile, saveProfile, getProfilePrompt } = await import('./profile.js');
import type { UserProfile } from './profile.js';

describe('User profile', () => {

  afterEach(() => {
    try { fs.unlinkSync(process.env.DAEDALUS_PROFILE_PATH!); } catch {}
    try { fs.rmdirSync(path.dirname(process.env.DAEDALUS_PROFILE_PATH!)); } catch {}
  });

  it('loadProfile returns default when no file exists', () => {
    const profile = loadProfile();
    expect(profile.name).toBe('');
    expect(profile.bio).toBe('');
    expect(profile.style).toBe('');
  });

  it('loadProfile returns default for corrupt file', () => {
    const dir = path.dirname(process.env.DAEDALUS_PROFILE_PATH!);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(process.env.DAEDALUS_PROFILE_PATH!, '{ broken', 'utf8');
    const profile = loadProfile();
    expect(profile.name).toBe('');
  });

  it('saveProfile and loadProfile round-trip', () => {
    const profile: UserProfile = {
      name: 'Test User',
      bio: 'A test user',
      style: 'no comments, named exports',
      updatedAt: 0,
    };
    saveProfile(profile);

    const loaded = loadProfile();
    expect(loaded.name).toBe('Test User');
    expect(loaded.bio).toBe('A test user');
    expect(loaded.style).toBe('no comments, named exports');
    expect(loaded.updatedAt).toBeGreaterThan(0);
  });

  it('getProfilePrompt returns empty string when profile is empty', () => {
    const profile: UserProfile = { name: '', bio: '', style: '', updatedAt: 0 };
    expect(getProfilePrompt(profile)).toBe('');
  });

  it('getProfilePrompt includes name when set', () => {
    const profile: UserProfile = { name: 'Jane', bio: '', style: '', updatedAt: 0 };
    expect(getProfilePrompt(profile)).toContain('Jane');
  });

  it('getProfilePrompt includes bio when set', () => {
    const profile: UserProfile = { name: '', bio: 'Full-stack developer', style: '', updatedAt: 0 };
    expect(getProfilePrompt(profile)).toContain('Full-stack');
  });

  it('getProfilePrompt includes style when set', () => {
    const profile: UserProfile = { name: '', bio: '', style: 'functional style', updatedAt: 0 };
    expect(getProfilePrompt(profile)).toContain('functional');
  });

  it('getProfilePrompt includes all fields when fully populated', () => {
    const profile: UserProfile = { name: 'Bob', bio: 'Backend dev', style: 'strict typing', updatedAt: 0 };
    const prompt = getProfilePrompt(profile);
    expect(prompt).toContain('Bob');
    expect(prompt).toContain('Backend dev');
    expect(prompt).toContain('strict typing');
  });

});
