import { describe, it, expect } from 'vitest';
import { feedbackCommand, redactSensitive, sanitizeEnv } from './feedback.js';

describe('Feedback Command', () => {
  it('should have correct command name', () => {
    expect(feedbackCommand.name).toBe('/feedback');
  });

  it('should have report alias', () => {
    expect(feedbackCommand.aliases).toContain('report');
  });

  it('should sanitize API keys', () => {
    const input = 'My API key is sk-abc123xyz and my token is Bearer secret123';
    const output = redactSensitive(input);
    expect(output).toContain('[REDACTED_API_KEY]');
    expect(output).toContain('[REDACTED_AUTH_TOKEN]');
    expect(output).not.toContain('sk-abc123xyz');
    expect(output).not.toContain('Bearer secret123');
  });

  it('should sanitize environment variables to only NODE_ENV and SHELL', () => {
    const originalEnv = { ...process.env };
    process.env.NODE_ENV = 'development';
    process.env.SHELL = '/bin/bash';
    process.env.API_KEY = 'secret123';
    process.env.PATH = '/usr/bin';

    const sanitized = sanitizeEnv();
    expect(sanitized).toHaveProperty('NODE_ENV', 'development');
    expect(sanitized).toHaveProperty('SHELL', '/bin/bash');
    expect(Object.keys(sanitized)).toHaveLength(2);
    expect(sanitized).not.toHaveProperty('API_KEY');
    expect(sanitized).not.toHaveProperty('PATH');

    Object.assign(process.env, originalEnv);
  });
});
