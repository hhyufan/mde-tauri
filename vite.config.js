import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const { transform: transformMonacoNls } = _require('monaco-editor-nls-adapter/transform');
const monacoNlsPlugin = {
  name: 'monaco-nls-fixed',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('\x00')) return null;
    const cleanId = id.split('?')[0].replace(/\\/g, '/');
    if (!cleanId.endsWith('.js') || !cleanId.includes('monaco-editor')) return null;
    if (!cleanId.includes('monaco-editor/esm')) return null;

    const result = transformMonacoNls(code, cleanId, {});
    if (cleanId.endsWith('/vs/editor/contrib/find/browser/findWidget.js')) {
      const outCode = (result && typeof result === 'object' ? result.code : result) || code;
      console.log(
        `[monaco-nls-fixed] findWidget transformed=${outCode.includes("nls.localize('vs/editor/contrib/find/browser/findWidget'")}`
      );
    }
    if (result && typeof result === 'object') {
      return result;
    }
    if (typeof result === 'string' && result !== code) {
      return { code: result, map: null };
    }
    return null;
  },
};


// Monaco ships a vendored copy of marked.js with a //# sourceMappingURL=marked.umd.js.map
// comment, but the .map file is not included in the npm package. Vite's loadAndTransform
// tries to extract the source map from the loaded code and errors with ENOENT. We intercept
// the file in a load hook, strip the sourceMappingURL comment, AND return a valid empty
// source map so Vite's `map == null` guard short-circuits and the extraction never runs.
const stripMonacoBrokenSourcemaps = {
  name: 'strip-monaco-broken-sourcemaps',
  enforce: 'pre',
  load(id) {
    if (id.includes('\x00')) return null;
    const cleanId = id.split('?')[0].replace(/\\/g, '/');
    if (cleanId.includes('monaco-editor') && /\/marked(\.umd)?\.js$/.test(cleanId)) {
      try {
        const code = readFileSync(cleanId, 'utf-8').replace(/\/\/[#@]\s*sourceMappingURL=\S+/g, '');
        return {
          code,
          map: { version: 3, sources: [], names: [], mappings: '', file: cleanId.split('/').pop() },
        };
      } catch {
        return null;
      }
    }
    return null;
  },
};

// Diagnostic plugin — prints whether the NLS transform actually ran on Monaco files.
// Runs AFTER the NLS plugin (no enforce), so it sees the post-transform code.
let _nlsReported = { seen: 0, transformed: 0, sampleMissing: [] };
const nlsDiagnostic = {
  name: 'nls-diagnostic',
  apply: 'serve',
  transform(code, id) {
    const cleanId = id.split('?')[0].replace(/\\/g, '/');
    if (!cleanId.includes('monaco-editor') || !cleanId.endsWith('.js')) return null;
    if (!cleanId.includes('/esm/')) return null;
    _nlsReported.seen++;
    const isTransformed =
      code.includes("nls.localize('vs/") ||
      code.includes('nls.localize("vs/') ||
      code.includes("nls.localize2('vs/") ||
      code.includes('nls.localize2("vs/');
    if (isTransformed) {
      _nlsReported.transformed++;
    } else if (_nlsReported.sampleMissing.length < 3 && /nls\.localize/.test(code)) {
      _nlsReported.sampleMissing.push(cleanId);
    }
    if (_nlsReported.seen % 20 === 0) {
      console.log(
        `[nls-diagnostic] seen=${_nlsReported.seen} transformed=${_nlsReported.transformed}` +
          (_nlsReported.sampleMissing.length
            ? ` missing-sample=${_nlsReported.sampleMissing[0]}`
            : '')
      );
    }
    return null;
  },
};

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    stripMonacoBrokenSourcemaps,
    monacoNlsPlugin,
    nlsDiagnostic,
    react(),
  ],

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
      // Redirect the NLS proxy specifier that the vite-plugin injects into monaco
      // source files to our ESM-native reimplementation. The upstream package
      // ships CJS-only, which esbuild pre-bundles as `export default` — that
      // breaks Monaco's `import * as nls from ...; nls.localize(...)` usage.
      // Our shim provides real named exports so monaco can call them.
      'monaco-editor-nls-adapter/proxy': resolve(
        __dirname,
        'src/vendor/monacoNlsProxy.js'
      ),
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
    include: ['shiki'],
    exclude: ['monaco-editor'],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    sourcemapIgnoreList: (sourcePath) => sourcePath.includes('node_modules'),
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
