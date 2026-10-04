import { afterEach, describe, expect, it } from 'vitest';
import useLspStore from '@store/useLspStore';
import { consoleAvailable, hasCodeEditor, supportsConsoleForTab } from './consoleSupport';

function resetLsp() {
  useLspStore.setState({
    enabled: true, catalog: [], sources: [], preferred: {}, installed: [], operations: {},
    statuses: {}, loading: false, loadError: '', revision: 0,
  });
}

describe('console availability', () => {
  afterEach(() => resetLsp());

  it('is available for runnable files regardless of installed language servers', () => {
    resetLsp();
    expect(supportsConsoleForTab({ name: 'main.py', ext: 'py' })).toBe(true);
    expect(supportsConsoleForTab({ name: 'App.KT', ext: 'kt' })).toBe(true);
    expect(supportsConsoleForTab({ name: 'main.RS', ext: 'rs' })).toBe(true);
    expect(supportsConsoleForTab({ name: 'Program.cs', ext: 'cs' })).toBe(true);
  });

  it('is available for languages covered by the LSP plugin catalog', () => {
    resetLsp();
    expect(supportsConsoleForTab({ name: 'app.ts', ext: 'ts' })).toBe(true);
    expect(supportsConsoleForTab({ name: 'index.html', ext: 'html' })).toBe(true);
    expect(supportsConsoleForTab({ name: 'style.scss', ext: 'scss' })).toBe(true);
  });

  it('is unavailable for plain files without LSP or runtime support', () => {
    resetLsp();
    expect(supportsConsoleForTab({ name: 'notes.txt', ext: 'txt' })).toBe(false);
    expect(supportsConsoleForTab({ name: 'README.md', ext: 'md' })).toBe(false);
    expect(supportsConsoleForTab({ name: 'data.json', ext: 'json' })).toBe(false);
    expect(supportsConsoleForTab(null)).toBe(false);
  });

  it('requires a code editor in the current view', () => {
    expect(hasCodeEditor('edit', { name: 'demo.md', ext: 'md' })).toBe(true);
    expect(hasCodeEditor('split', { name: 'demo.mgtree', ext: 'mgtree' })).toBe(true);
    expect(hasCodeEditor('preview', { name: 'demo.md', ext: 'md' })).toBe(false);
    expect(hasCodeEditor('preview', { name: 'demo.mgtree', ext: 'mgtree' })).toBe(false);
    expect(hasCodeEditor('preview', { name: 'main.py', ext: 'py' })).toBe(true);
    expect(hasCodeEditor('preview', null)).toBe(false);
  });

  it('combines the editor and language conditions', () => {
    resetLsp();
    expect(consoleAvailable('edit', { name: 'main.py', ext: 'py' })).toBe(true);
    expect(consoleAvailable('edit', { name: 'notes.txt', ext: 'txt' })).toBe(false);
    expect(consoleAvailable('preview', { name: 'demo.mgtree', ext: 'mgtree' })).toBe(false);
  });
});
