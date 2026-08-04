import { describe, it, expect } from 'vitest';
import { errMessage } from './errors.js';

describe('errMessage', () => {
  it('returns the message for an Error', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error values', () => {
    expect(errMessage('plain string')).toBe('plain string');
    expect(errMessage(42)).toBe('42');
    expect(errMessage({ foo: 'bar' })).toBe('[object Object]');
  });
});
