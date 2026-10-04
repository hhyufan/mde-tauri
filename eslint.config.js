import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import react from 'eslint-plugin-react';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/target/**',
      // 额外命名的 Cargo 目标目录（例如 target-monaco-fix）同样是构建产物。
      'src-tauri/target-*/**',
      'src-tauri/gen/**',
      'showcase/**',
      'mde-tauri/**',
      // 仓库根目录下的同级目录/临时产物，不属于本应用，各自有自己的构建与 lint
      // 配置。不排除它们会让 `eslint .` 把别的工程算进来（并因此报出成百上千条
      // 与本应用无关的错误）。
      'outputs/**',
      'miaogu-notepad/**',
      'releases/**',
      '.dbg/**',
      '.codex-mde-server-editor/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}', 'vite.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-useless-escape': 'off',
      'no-regex-spaces': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
];
