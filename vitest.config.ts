import { defineConfig } from 'vitest/config';

// Specs run in the default Node environment, which exposes the same WebCrypto SubtleCrypto
// API (globalThis.crypto.subtle) that workerd does — proving algorithmic byte-compatibility
// without a Workers deploy. These helpers are infra-only (no DB), so no local MySQL needed.
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    testTimeout: 15000,
  },
});
