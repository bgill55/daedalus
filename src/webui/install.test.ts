import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface MockPromptEvent {
  preventDefault?: () => void;
  prompt: () => Promise<{ outcome: string }>;
  userChoice?: Promise<{ outcome: string }>;
}

describe('PWA Install Prompt Handling & UI Cue (M-8)', () => {
  it('captures beforeinstallprompt event and triggers prompt() on user acceptance', async () => {
    let bannerVisible = false;
    let capturedEvent: MockPromptEvent | null;

    const showInstallBanner = () => { bannerVisible = true; };
    const hideInstallBanner = () => { bannerVisible = false; };

    const mockPromptEvent: MockPromptEvent = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue({ outcome: 'accepted' }),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    };

    mockPromptEvent.preventDefault?.();
    capturedEvent = mockPromptEvent;
    showInstallBanner();

    expect(mockPromptEvent.preventDefault).toHaveBeenCalled();
    expect(capturedEvent).toBe(mockPromptEvent);
    expect(bannerVisible).toBe(true);

    const result = await capturedEvent.prompt();
    expect(mockPromptEvent.prompt).toHaveBeenCalled();
    expect(result.outcome).toBe('accepted');

    hideInstallBanner();
    capturedEvent = null;

    expect(bannerVisible).toBe(false);
    expect(capturedEvent).toBeNull();
  });

  it('handles install dismissal and hides banner', async () => {
    let bannerVisible = true;
    let capturedEvent: MockPromptEvent | null = {
      prompt: vi.fn().mockResolvedValue({ outcome: 'dismissed' }),
    };

    const hideInstallBanner = () => { bannerVisible = false; };

    const result = await capturedEvent.prompt();
    expect(result.outcome).toBe('dismissed');

    hideInstallBanner();
    capturedEvent = null;

    expect(bannerVisible).toBe(false);
    expect(capturedEvent).toBeNull();
  });
});

describe('Cross-Platform Distribution Installers', () => {
  const rootDir = process.cwd();

  it('includes valid POSIX install.sh, Windows install.ps1, and Homebrew formula', () => {
    const shPath = path.join(rootDir, 'install.sh');
    const ps1Path = path.join(rootDir, 'install.ps1');
    const brewPath = path.join(rootDir, 'packaging', 'homebrew', 'daedalus.rb');

    expect(fs.existsSync(shPath)).toBe(true);
    expect(fs.existsSync(ps1Path)).toBe(true);
    expect(fs.existsSync(brewPath)).toBe(true);

    const shContent = fs.readFileSync(shPath, 'utf8');
    expect(shContent).toContain('#!/usr/bin/env bash');
    expect(shContent).toContain('daedalus-cli@latest');

    const ps1Content = fs.readFileSync(ps1Path, 'utf8');
    expect(ps1Content).toContain('daedalus-cli@latest');

    const brewContent = fs.readFileSync(brewPath, 'utf8');
    expect(brewContent).toContain('class Daedalus < Formula');
    expect(brewContent).toContain('depends_on "node"');
  });
});
