import { describe, it, expect } from 'vitest';
import { normalizeAutopilotIdea } from './agents.js';

describe('normalizeAutopilotIdea', () => {
  it('strips a leading /autopilot command token', () => {
    expect(normalizeAutopilotIdea('/autopilot Improve the ESLint config')).toBe(
      'Improve the ESLint config'
    );
  });

  it('strips any leading slash-command token (re-pasted command)', () => {
    expect(normalizeAutopilotIdea('/autopilot Add a GET /api/health/detail endpoint')).toBe(
      'Add a GET /api/health/detail endpoint'
    );
  });

  it('leaves a plain feature description untouched', () => {
    expect(normalizeAutopilotIdea('Add user authentication')).toBe('Add user authentication');
  });

  it('collapses surrounding whitespace', () => {
    expect(normalizeAutopilotIdea('   /autopilot   refactor the parser   ')).toBe('refactor the parser');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(normalizeAutopilotIdea('')).toBe('');
    expect(normalizeAutopilotIdea('   ')).toBe('');
    expect(normalizeAutopilotIdea('/autopilot')).toBe('');
  });
});
