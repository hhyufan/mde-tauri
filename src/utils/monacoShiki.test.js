import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { shikiToMonaco } from '@shikijs/monaco';

const mock = vi.hoisted(() => ({
  editor: { create: vi.fn(), setTheme: vi.fn(), defineTheme: vi.fn() },
  languages: { getLanguages: () => [], setTokensProvider: vi.fn() },
  createHighlighter: vi.fn(), highlighter: null, nativeCreate: null, nativeSetTheme: null,
}));
vi.mock('monaco-editor', () => ({ editor: mock.editor, languages: mock.languages }));
vi.mock('shiki', () => ({ createHighlighter: mock.createHighlighter }));
vi.mock('./mgtreeLanguage', () => ({ registerMgtreeLanguage: vi.fn(), treeTokenRules: () => [] }));
// The standalone editor runtime must not pull in the application's store graph.
vi.mock('@store/useLspStore', () => { throw new Error('Highlighter imported application stores'); });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete mock.editor[Symbol.for('mde.monaco.shiki.runtime')];
  mock.nativeCreate = mock.editor.create = vi.fn(() => ({ dispose: vi.fn() }));
  mock.nativeSetTheme = mock.editor.setTheme = vi.fn();
  document.documentElement.dataset.theme = 'light';
  const themes = {
    'one-light': { type: 'light', rules: [], colors: {} },
    'one-dark-pro': { type: 'dark', rules: [], colors: {} },
  };
  mock.highlighter = {
    getLoadedThemes: () => Object.keys(themes), getLoadedLanguages: () => [],
    getTheme: (name) => {
      if (!themes[name]) throw new Error(`Theme ${name} not found`);
      return themes[name];
    },
    setTheme: vi.fn((name) => {
      if (!themes[name]) throw new Error(`Theme ${name} not found`);
      return { colorMap: ['', '#ffffff'] };
    }),
  };
  mock.createHighlighter.mockResolvedValue(mock.highlighter);
});
afterEach(() => vi.restoreAllMocks());

it('normalizes built-in theme aliases for the real Shiki adapter and editor creation', async () => {
  const runtime = await import('./monacoShiki');
  await runtime.initMonacoShiki();
  expect(() => mock.editor.setTheme('vs')).not.toThrow();
  expect(mock.highlighter.setTheme).toHaveBeenLastCalledWith('one-light');
  expect(() => mock.editor.create({}, { theme: 'vs-dark' })).not.toThrow();
  expect(mock.nativeCreate).toHaveBeenLastCalledWith({}, { theme: 'one-dark-pro' }, undefined);
  document.documentElement.dataset.theme = 'dark';
  mock.editor.create({});
  expect(mock.nativeCreate).toHaveBeenLastCalledWith({}, { theme: 'one-dark-pro' }, undefined);
});

it('keeps readiness and patched methods across module replacement instead of bootstrapping twice', async () => {
  const first = await import('./monacoShiki');
  await Promise.all([first.initMonacoShiki(), first.initMonacoShiki()]);
  const create = mock.editor.create;
  vi.resetModules();
  const replaced = await import('./monacoShiki');
  expect(replaced.isMonacoShikiReady()).toBe(true);
  expect(replaced.getMonacoThemeName(false)).toBe('one-light');
  await replaced.initMonacoShiki();
  expect(mock.editor.create).toBe(create);
  expect(mock.createHighlighter).toHaveBeenCalledTimes(1);
  expect(() => mock.editor.create({}, { theme: replaced.getMonacoThemeName(false) })).not.toThrow();
});

it('can create an editor while replacing an older Shiki-patched module before initialization finishes', async () => {
  shikiToMonaco(mock.highlighter, mock);
  const runtime = await import('./monacoShiki');
  expect(runtime.isMonacoShikiReady()).toBe(false);
  expect(() => mock.editor.create({}, { theme: runtime.getMonacoThemeName(false) })).not.toThrow();
  expect(() => mock.editor.create({}, { theme: 'vs-dark' })).not.toThrow();
  expect(() => mock.editor.setTheme('vs')).not.toThrow();
  await runtime.initMonacoShiki();
  expect(() => mock.editor.setTheme('vs-dark')).not.toThrow();
});

it('keeps a working fallback and allows retry after bootstrap failure', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  mock.createHighlighter.mockRejectedValueOnce(new Error('resource unavailable'));
  const runtime = await import('./monacoShiki');
  await runtime.initMonacoShiki();
  expect(runtime.isMonacoShikiReady()).toBe(false);
  expect(mock.editor.defineTheme).toHaveBeenCalledWith('one-light', expect.objectContaining({ base: 'vs', inherit: true }));
  expect(() => mock.editor.create({}, { theme: runtime.getMonacoThemeName(false) })).not.toThrow();
  mock.editor.setTheme('vs-dark');
  expect(mock.nativeSetTheme).toHaveBeenLastCalledWith('one-dark-pro');
  expect(errors).toHaveBeenCalled();
  await runtime.initMonacoShiki();
  expect(runtime.isMonacoShikiReady()).toBe(true);
  expect(mock.createHighlighter).toHaveBeenCalledTimes(2);
});

it('does not leave public Monaco methods partially patched if Shiki throws while applying a theme', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mock.highlighter.setTheme.mockImplementationOnce(() => { throw new Error('theme initialization failed'); });
  const runtime = await import('./monacoShiki');
  await runtime.initMonacoShiki();
  expect(() => mock.editor.create({}, { theme: runtime.getMonacoThemeName(true) })).not.toThrow();
  expect(mock.nativeCreate).toHaveBeenLastCalledWith({}, { theme: 'one-dark-pro' }, undefined);
  expect(() => mock.editor.setTheme('vs')).not.toThrow();
});
