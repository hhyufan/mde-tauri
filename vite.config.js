import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

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

// `monaco-editor-nls-adapter` used to rewrite every `nls.localize(...)` call in
// Monaco's ESM sources at build time so its UI could be translated through a
// runtime proxy. That pipeline turned out to be far more fragile than it was
// worth: it rewrote 160+ upstream modules, needed a custom CJS→ESM proxy shim,
// and required build-time chunk-order assertions just to keep the locale
// dictionary ahead of the editor. It has been removed; Monaco now ships its
// stock English UI, which needs no rewriting at all.
//
// This guard keeps the removal honest: any transitive import that reintroduces
// the adapter fails the build loudly instead of silently rebuilding the whole
// fragile pipeline.
const assertNoMonacoNls = {
  name: 'assert-no-monaco-nls',
  enforce: 'pre',
  transform(_code, id) {
    if (id.includes('monaco-editor-nls-adapter')) {
      this.error(
        'monaco-editor-nls-adapter is no longer part of the Monaco pipeline. ' +
          'Remove the import instead of reintroducing the NLS source rewriting.'
      );
    }
    return null;
  },
};

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [stripMonacoBrokenSourcemaps, assertNoMonacoNls, react()],

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
    // Tauri 2 only ships modern engines (WebView2 Evergreen, WKWebView,
    // WebKitGTK 4.1) — keep the bundle truly modern and skip transpiling
    // class fields, top-level await, etc.
    target: 'esnext',
    // Disable BOTH the polyfill and the auto-injected `<link rel="modulepreload">`
    // tags. Reasoning:
    //   1) The polyfill is unnecessary on Tauri's modern WebViews.
    //   2) Vite preloads the dependencies of *every* dynamic import (e.g. it
    //      eagerly preloads monaco-vendor because LazyMonacoEditor exists).
    //      In a Tauri app the assets are read from disk over a custom
    //      protocol, so there's no network latency to hide — modulepreload
    //      only adds fetch+parse cost for code that may never run during
    //      this session (the user might never open the editor). For our
    //      heaviest chunk (monaco-vendor ≈ 3.3 MB) this saved up to a full
    //      second of V8 parse time off the cold-start path.
    modulePreload: false,
    // CSS for lazy chunks (Monaco, etc.) shouldn't block first paint.
    cssCodeSplit: true,
    minify: 'terser',
    chunkSizeWarningLimit: 5000,
    reportCompressedSize: false,
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: false,
      },
    },
    rollupOptions: {
      output: {
        // Keep the entry chunk as small as possible. Heavy deps go into
        // their own vendor chunks so they only download/parse on demand.
        //
        // Use a function instead of Rollup's object form so Vite's internal
        // preload helper does not accidentally get placed into monaco-vendor.
        // If the entry imports that helper from monaco-vendor, Monaco executes
        // at app startup before the highlight/theme bootstrap can run.
        manualChunks(id) {
          if (id.includes('\x00vite/preload-helper')) return 'vite-preload-helper';
          if (!id.includes('node_modules')) return undefined;

          // Path normalization — avoid greedy `id.includes('react')` matches
          // that previously sucked in random "react-*" siblings (e.g.
          // react-html-attributes) into react-vendor. Those drag in their
          // own dependencies on antd, which then makes react-vendor
          // statically import antd-vendor — a circular ESM cycle that the
          // Android WebView surfaces as `Cannot read properties of
          // undefined (reading 'createContext')` because antd-vendor is
          // forced to evaluate before react-vendor finishes initializing.
          const norm = id.replace(/\\/g, '/');
          const pkgMatch = norm.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
          const pkgName = pkgMatch ? pkgMatch[1] : '';

          // Keep Monaco in exactly one chunk. Monaco registers its editor
          // contributions, languages and keybindings as module side effects, so
          // it must never be duplicated across chunks: a second copy would
          // create an editor whose tokenizers and keybinding service are
          // registered on a different module registry.
          if (pkgName === 'monaco-editor') return 'monaco-vendor';
          if (pkgName === '@antv/g2') return 'antv-vendor';
          if (pkgName === 'axios') return 'axios-vendor';
          if (pkgName === 'react-markdown'
            || pkgName.startsWith('@milkdown/')
            || pkgName === 'katex'
            || pkgName === 'remark-gfm'
            || pkgName === 'remark-math'
            || pkgName === 'rehype-raw'
            || pkgName === 'rehype-highlight'
            || pkgName === 'rehype-katex'
            || pkgName === 'rehype-sanitize') return 'markdown-vendor';
          if (pkgName === 'shiki' || pkgName === '@shikijs/monaco') return 'highlight-vendor';
          if (pkgName === '@tauri-apps/api'
            || pkgName === '@tauri-apps/plugin-fs'
            || pkgName === '@tauri-apps/plugin-dialog'
            || pkgName === '@tauri-apps/plugin-store') return 'tauri-vendor';
          if (pkgName === 'react-i18next'
            || pkgName === 'i18next'
            || pkgName === 'i18next-browser-languagedetector') return 'i18n-vendor';
          if (pkgName === 'antd' || pkgName === '@ant-design/icons' || pkgName === '@ant-design/cssinjs') return 'antd-vendor';
          // ONLY the real React runtime + things React depends on. Anything
          // else with "react" in its package name (react-i18next,
          // react-markdown, react-html-attributes, react-material-vscode-icons,
          // react-diff-viewer, …) falls through to be handled by the
          // matching rule above or auto-chunked by Rollup.
          if (pkgName === 'react'
            || pkgName === 'react-dom'
            || pkgName === 'scheduler'
            || pkgName === 'use-sync-external-store'
            || pkgName === 'object-assign') return 'react-vendor';
          return undefined;
        },
      },
    },
  },

  optimizeDeps: {
    // Shiki and its Monaco bridge are loaded lazily by the highlight bootstrap.
    // Pre-bundling them keeps a cold `vite dev` start from discovering them
    // mid-session and triggering an extra full reload.
    include: ['shiki', '@shikijs/monaco'],
    // Monaco is intentionally served/processed as source: the highlight and
    // theme bootstrap must run against the same module instance the editor is
    // created from, and esbuild prebundling would duplicate it.
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
