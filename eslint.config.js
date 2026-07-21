import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals'; export default tseslint.config( eslint.configs.recommended, ...tseslint.configs.recommended, { languageOptions: { globals: { ...globals.node }, }, }, { files: ['src/**/*.ts'], }, { ignores: ['dist/', '**/*.js', '**/*.mjs', '**/*.cjs'], }, { rules: { 'prefer-const': 'warn', 'no-empty': 'warn', 'no-useless-assignment': 'warn', 'no-useless-escape': 'off', 'no-control-regex': 'off', '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], '@typescript-eslint/no-explicit-any': 'off', 'preserve-caught-error': 'off', }, },
);
