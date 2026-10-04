import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import useEditorStore from '@store/useEditorStore';
import useScriptStore from '@store/useScriptStore';
import { clearBuffer, setBuffer } from '@utils/editorBuffer';
import { getCodeBlockLanguage, getScriptLanguage, handleScriptShortcut, scriptRunner } from './scriptRunner';
import useCodeBlockRunStore from '@store/useCodeBlockRunStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
let output;
beforeEach(() => {
  window.__TAURI_INTERNALS__ = {};
  useEditorStore.setState({ tabs: [], tabRenderList: [] });
  useEditorStore.getState().openFile({ path: 'test.js', name: 'test.js', content: 'saved' });
  useScriptStore.setState({ runId: null, status: 'idle', logs: [], open: false, runtimePaths: {} });
  useCodeBlockRunStore.setState({ blocks: {} });
  listen.mockImplementation(async (_name, callback) => { output = callback; return vi.fn(); });
  invoke.mockResolvedValue(undefined);
});
afterEach(() => { clearBuffer('test.js'); vi.clearAllMocks(); });

describe('script execution', () => {
  it('recognizes supported extensions', () => {
    expect(getScriptLanguage('FILE.CS')).toBe('csharp');
    expect(getScriptLanguage('test.mjs')).toBe('javascript');
    expect(getScriptLanguage('test.cjs')).toBe('javascript');
    expect(getScriptLanguage('test.py')).toBe('python');
    expect(getScriptLanguage('Main.java')).toBe('java');
    expect(getScriptLanguage('App.KT')).toBe('kotlin');
    expect(getScriptLanguage('build.kts')).toBe('kotlin');
    expect(getScriptLanguage('main.RS')).toBe('rust');
    expect(getCodeBlockLanguage('rust')).toBe('rust');
    expect(getCodeBlockLanguage('rs')).toBe('rust');
    expect(getScriptLanguage('readme.md')).toBeNull();
  });
  it('subscribes first, executes the live buffer and captures output before invoke resolves', async () => {
    setBuffer('test.js', 'console.log("最新内容")');
    invoke.mockImplementationOnce(async (_command, { request }) => {
      expect(output).toBeTypeOf('function');
      output({ payload: { runId: request.runId, kind: 'stdout', text: '最新内容\n' } });
      output({ payload: { runId: request.runId, kind: 'exit', exitCode: 0, elapsedMs: 20 } });
    });
    await scriptRunner.runCurrent();
    expect(invoke.mock.calls[0][0]).toBe('start_script');
    expect(invoke.mock.calls[0][1].request.source).toBe('console.log("最新内容")');
    expect(useScriptStore.getState()).toMatchObject({ status: 'success', open: true, elapsedMs: 20 });
    expect(useScriptStore.getState().logs[0].text).toBe('最新内容\n');
  });
  it('ignores output from a previous run and bounds large output', () => {
    const state = useScriptStore.getState();
    state.prepare({ runId: 'new', fileName: 'test.js', language: 'javascript' });
    state.receive({ runId: 'old', kind: 'stderr', text: 'old failure' });
    expect(useScriptStore.getState().logs).toEqual([]);
    state.receive({ runId: 'new', kind: 'stdout', text: 'x'.repeat(400000) });
    expect(useScriptStore.getState().logs[0].text.length).toBe(256 * 1024);
    expect(useScriptStore.getState().truncated).toBe(true);
  });
  it('prevents overlapping runs', async () => {
    useScriptStore.setState({ status: 'running' });
    await scriptRunner.runCurrent();
    expect(invoke).not.toHaveBeenCalled();
    expect(useScriptStore.getState().open).toBe(true);
  });
  it('reports unsupported files in the console', async () => {
    useEditorStore.getState().openFile({ path: 'readme.md', name: 'readme.md', content: '# note' });
    await scriptRunner.runCurrent();
    expect(useScriptStore.getState().status).toBe('error');
    expect(useScriptStore.getState().logs[0].text).toContain('F5');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('reserves F5 and Shift+F5, without consuming IME keys or repeated runs', () => {
    const run = vi.spyOn(scriptRunner, 'runCurrent').mockResolvedValue();
    const stop = vi.spyOn(scriptRunner, 'stop').mockResolvedValue();
    const event = { key: 'F5', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(handleScriptShortcut({ ...event, isComposing: true })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(handleScriptShortcut(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    handleScriptShortcut({ ...event, repeat: true });
    expect(run).toHaveBeenCalledTimes(1);
    handleScriptShortcut({ ...event, shiftKey: true });
    expect(stop).toHaveBeenCalledTimes(1);
    run.mockRestore(); stop.mockRestore();
  });
  it('echoes accepted input before a fast response and exit, and prevents duplicate pending writes', async () => {
    await scriptRunner.runCurrent();
    const runId = useScriptStore.getState().runId;
    output({ payload: { runId, kind: 'status', text: 'started' } });
    output({ payload: { runId, kind: 'stdout', text: '请输入数字：' } });
    let complete;
    invoke.mockImplementationOnce(() => {
      output({ payload: { runId, kind: 'stdout', text: '太小了！\n' } });
      output({ payload: { runId, kind: 'exit', exitCode: 0 } });
      return new Promise((resolve) => { complete = resolve; });
    });
    const pending = scriptRunner.sendInput('23');
    expect(await scriptRunner.sendInput('23')).toBe(false);
    expect(useScriptStore.getState().logs.map((entry) => entry.text).join('')).toBe('请输入数字：');
    complete();
    expect(await pending).toBe(true);
    expect(useScriptStore.getState().logs.map((entry) => entry.text).join('')).toBe('请输入数字：23\n太小了！\n');
    expect(useScriptStore.getState().status).toBe('success');
    expect(invoke.mock.calls.filter(([command]) => command === 'write_script_input')).toHaveLength(1);
  });
  it('does not echo failed input and still delivers buffered output', async () => {
    await scriptRunner.runCurrent();
    const runId = useScriptStore.getState().runId;
    output({ payload: { runId, kind: 'status', text: 'started' } });
    invoke.mockImplementationOnce(async () => {
      output({ payload: { runId, kind: 'stdout', text: '程序结束\n' } });
      output({ payload: { runId, kind: 'exit', exitCode: 0 } });
      throw new Error('输入已关闭');
    });
    expect(await scriptRunner.sendInput('23')).toBe(false);
    expect(useScriptStore.getState().logs.some((entry) => entry.kind === 'stdin')).toBe(false);
    expect(useScriptStore.getState().logs.map((entry) => entry.text).join('')).toContain('程序结束\n');
    expect(useScriptStore.getState().status).toBe('success');
  });
});

describe('Markdown code blocks', () => {
  it('accepts only the supported language families and their fence aliases', () => {
    for (const value of ['cs', 'C#', 'csharp']) expect(getCodeBlockLanguage(value)).toBe('csharp');
    expect(getCodeBlockLanguage('javascript title=demo')).toBe('javascript');
    expect(getCodeBlockLanguage('py')).toBe('python');
    expect(getCodeBlockLanguage('java')).toBe('java');
    for (const value of ['kt', 'kts', 'kotlin']) expect(getCodeBlockLanguage(value)).toBe('kotlin');
    for (const value of ['jsx', 'typescript', 'bash', '', '__proto__']) expect(getCodeBlockLanguage(value)).toBeNull();
  });
  it('routes simultaneous block outputs separately without opening the bottom console', async () => {
    await Promise.all([
      scriptRunner.runBlock({ key: 'a', language: 'python', source: 'print("A")', filePath: 'C:/notes/demo.md' }),
      scriptRunner.runBlock({ key: 'b', language: 'javascript', source: 'console.log("B")', filePath: 'C:/notes/demo.md' }),
    ]);
    const a = useCodeBlockRunStore.getState().blocks.a.runId;
    const b = useCodeBlockRunStore.getState().blocks.b.runId;
    expect(a).not.toBe(b);
    expect(invoke.mock.calls[0][1].request).toMatchObject({ source: 'print("A")', cacheKey: 'a' });
    output({ payload: { runId: b, kind: 'stderr', text: 'B error' } });
    output({ payload: { runId: a, kind: 'stdout', text: 'A result' } });
    output({ payload: { runId: b, kind: 'exit', exitCode: 1 } });
    output({ payload: { runId: a, kind: 'exit', exitCode: 0 } });
    expect(useCodeBlockRunStore.getState().blocks.a).toMatchObject({ status: 'success', logs: [{ kind: 'stdout', text: 'A result' }] });
    expect(useCodeBlockRunStore.getState().blocks.b).toMatchObject({ status: 'error', logs: [{ kind: 'stderr', text: 'B error' }] });
    expect(useScriptStore.getState().open).toBe(false);
  });
  it('stops and sends input to the requested block only, and rejects duplicate runs', async () => {
    await scriptRunner.runBlock({ key: 'input', language: 'python', source: 'input()' });
    const runId = useCodeBlockRunStore.getState().blocks.input.runId;
    await scriptRunner.runBlock({ key: 'input', language: 'python', source: 'input()' });
    expect(invoke).toHaveBeenCalledTimes(1);
    output({ payload: { runId, kind: 'status', text: 'started' } });
    expect(await scriptRunner.sendBlockInput('input', '中文')).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('write_script_input', { runId, text: '中文' });
    await scriptRunner.stopBlock('input');
    expect(invoke).toHaveBeenLastCalledWith('stop_script', { runId });
    output({ payload: { runId, kind: 'exit', exitCode: 1, cancelled: true } });
    expect(useCodeBlockRunStore.getState().blocks.input.status).toBe('stopped');
  });
  it('keeps code-block input ahead of its response without buffering another block', async () => {
    await scriptRunner.runBlock({ key: 'input', language: 'python', source: 'input()' });
    await scriptRunner.runBlock({ key: 'other', language: 'python', source: 'print(1)' });
    const runId = useCodeBlockRunStore.getState().blocks.input.runId;
    const other = useCodeBlockRunStore.getState().blocks.other.runId;
    output({ payload: { runId, kind: 'status', text: 'started' } });
    output({ payload: { runId, kind: 'stdout', text: 'Name?' } });
    invoke.mockImplementationOnce(async () => {
      output({ payload: { runId, kind: 'stdout', text: '你好\n' } });
      output({ payload: { runId: other, kind: 'stdout', text: 'other\n' } });
      expect(useCodeBlockRunStore.getState().blocks.other.logs[0].text).toBe('other\n');
    });
    expect(await scriptRunner.sendBlockInput('input', '中文')).toBe(true);
    expect(useCodeBlockRunStore.getState().blocks.input.logs.map((entry) => entry.text).join('')).toBe('Name?中文\n你好\n');
  });
});
