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
      // 相対 import には明示拡張子（.js）を必須化する。source は bundler 前提
      // （module:ESNext / moduleResolution:Bundler）で書くが、tsc は specifier を
      // そのまま emit するため、拡張子が無いと dist が Node ESM で読めなくなり、
      // registry コピー導入の consumer（npm ci → vitest が Node 直読み）で壊れる。
      // postbuild での自動付与をやめた代わりに、この規約をここで強制する。
      'import-x/extensions': ['error', 'ignorePackages', { ts: 'never', tsx: 'never', js: 'always' }],
    },
  },
);
