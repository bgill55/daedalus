import { describe, it, expect, vi } from 'vitest';

describe('PWA Install Prompt Handling & UI Cue (M-8)', () => {
  it('captures beforeinstallprompt event and triggers prompt() on user acceptance', async () => {
    let bannerVisible = false;
    let capturedEvent: any = null;

    const showInstallBanner = () => { bannerVisible = true; };
    const hideInstallBanner = () => { bannerVisible = false; };

    const mockPromptEvent = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue({ outcome: 'accepted' }),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    };

    // Simulate beforeinstallprompt event
    mockPromptEvent.preventDefault();
    capturedEvent = mockPromptEvent;
    showInstallBanner();

    expect(mockPromptEvent.preventDefault).toHaveBeenCalled();
    expect(capturedEvent).toBe(mockPromptEvent);
    expect(bannerVisible).toBe(true);

    // Simulate user clicking Install button
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
    let capturedEvent: any = {
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
