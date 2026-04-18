import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@components': resolve(__dirname, './src/components'),
      '@layout': resolve(__dirname, './src/components/layout'),
      '@ui': resolve(__dirname, './src/components/ui'),
      '@assets': resolve(__dirname, './src/assets'),
      '@styles': resolve(__dirname, './src/assets/styles'),
      '@hooks': resolve(__dirname, './src/hooks'),
      '@utils': resolve(__dirname, './src/utils'),
      '@store': resolve(__dirname, './src/store'),
    },
  },

  build: {
    target: 'esnext',
    minify: 'terser',
    chunkSizeWarningLimit: 5000,
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: false,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'antd-vendor': ['antd', '@ant-design/icons'],
          'monaco-vendor': ['monaco-editor'],
          'highlight-vendor': ['shiki', '@shikijs/monaco'],
          'markdown-vendor': [
            'react-markdown',
            'remark-gfm',
            'remark-math',
            'rehype-raw',
            'rehype-highlight',
            'rehype-katex',
            'rehype-sanitize',
          ],
          'antv-vendor': ['@antv/g2'],
          'axios-vendor': ['axios'],
          'i18n-vendor': ['react-i18next', 'i18next', 'i18next-browser-languagedetector'],
          'tauri-vendor': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-fs',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-opener',
            '@tauri-apps/plugin-store',
          ],
        },
      },
    },
  },

  optimizeDeps: {
    include: ['monaco-editor', 'shiki'],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
