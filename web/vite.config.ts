/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const coreRoot = fileURLToPath(new URL('../packages/core', import.meta.url));

// base: './' so the static build can be served from any subdirectory.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@grimcomp/core': fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(webRoot), coreRoot],
    },
  },
  // The PR0 safety net: pure-unit tests for the content + rules engine run in a
  // plain Node environment (no DOM needed — these modules never touch the
  // browser). Component tests can opt into jsdom later per-file.
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 5_000,
    hookTimeout: 5_000,
  },
});
