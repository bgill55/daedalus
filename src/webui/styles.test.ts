import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('WebUI Responsive Styles', () => {
  const stylesPath = path.resolve(__dirname, 'public/styles.css');
  const css = fs.readFileSync(stylesPath, 'utf-8');

  it('includes @media queries for max-width: 900px', () => {
    expect(css).toContain('@media (max-width: 900px)');
  });

  it('includes @media queries for max-width: 600px', () => {
    expect(css).toContain('@media (max-width: 600px)');
  });

  it('configures mobile viewport fluid reflow and overflow protection', () => {
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('max-width: 100vw');
    expect(css).toContain('box-sizing: border-box');
  });
});
