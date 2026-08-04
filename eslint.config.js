import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
  },
  {
    ignores: ['dist/', '**/*.js', '**/*.mjs', '**/*.cjs'],
  },
  {
    rules: {
      'prefer-const': 'warn',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'preserve-caught-error': 'off',
      // Enforce the project's zero-TODO convention (see AGENTS.md / roles.ts):
      // block TODO/FIXME/HACK/XXX comments in delivered source so debt can't
      // accumulate silently. String-literal mentions (e.g. the agent's own
      // system-prompt text in roles.ts) are not real comments and are ignored.
      'no-warning-comments': ['error', { terms: ['TODO', 'FIXME', 'HACK', 'XXX'], location: 'start' }],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
