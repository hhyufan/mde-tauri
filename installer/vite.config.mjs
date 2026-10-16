import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-installer', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@utils': fileURLToPath(new URL('../src/utils', import.meta.url)),
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  server: { port: 1423, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'esnext' },
});
