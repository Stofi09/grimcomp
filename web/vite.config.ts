/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base: './' so the static build can be served from any subdirectory.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // The PR0 safety net: pure-unit tests for the content + rules engine run in a
  // plain Node environment (no DOM needed — these modules never touch the
  // browser). Component tests can opt into jsdom later per-file.
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
