import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@utils': resolve(import.meta.dirname, 'src/utils'),
      '@store': resolve(import.meta.dirname, 'src/store'),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    coverage: { reporter: ['text', 'html'] },
  },
});
