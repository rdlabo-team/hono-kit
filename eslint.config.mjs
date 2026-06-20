// @ts-check
// Mirrors the fleet's eslint setup (receptray/winecode hono): @hono/eslint-config
// (strict type-checked + import-x ordering, formatting left to Prettier) plus type-aware
// linting via projectService. Same three strictTypeChecked relaxations as the consumers so
// re-exported / moved source stays lint-consistent across the fleet.
import baseConfig from '@hono/eslint-config';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'vitest.config.ts', 'prettier.config.mjs'],
  },
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
