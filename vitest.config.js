import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^monaco-editor$/,
        replacement: resolve(
          import.meta.dirname,
          'node_modules/monaco-editor/esm/vs/editor/editor.main.js',
        ),
      },
      { find: '@', replacement: resolve(import.meta.dirname, 'src') },
      { find: '@utils', replacement: resolve(import.meta.dirname, 'src/utils') },
      { find: '@store', replacement: resolve(import.meta.dirname, 'src/store') },
      { find: '@components', replacement: resolve(import.meta.dirname, 'src/components') },
      { find: '@hooks', replacement: resolve(import.meta.dirname, 'src/hooks') },
    ],
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    coverage: { reporter: ['text', 'html'] },
  },
});
