import { describe, it, expect } from 'vitest';
import { generateStandardBadges, generateCustomBadge } from './badge.js';

describe('/badge command generator', () => {

  it('generateStandardBadges generates badges from package.json', () => {
    const badges = generateStandardBadges(process.cwd());
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]).toContain('img.shields.io');
  });

  it('generateCustomBadge formats Shields.io badge markdown', () => {
    const badge = generateCustomBadge({
      label: 'downloads',
      message: '10k',
      color: 'orange',
      logo: 'github',
      link: 'https://github.com/bgill55/daedalus'
    });
    expect(badge).toContain('img.shields.io/badge/downloads-10k-orange');
    expect(badge).toContain('logo=github');
    expect(badge).toContain('https://github.com/bgill55/daedalus');
  });

});
