import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import useScriptStore from '@store/useScriptStore';
import { scriptRunner } from '@/services/scriptRunner';
import i18n from '@/i18n';
import OutputConsole from './OutputConsole';
import useProblemsStore from '@store/useProblemsStore';

globalThis.React = React;
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ openFileFromPath: vi.fn() }) }));
vi.mock('@/services/scriptRunner', () => ({
  getScriptLanguage: (name = '') => ((name || '').toLowerCase().endsWith('.py') ? 'python' : null),
  scriptRunner: { runCurrent: vi.fn(), stop: vi.fn(), sendInput: vi.fn(async () => true) },
}));
beforeEach(() => {
  i18n.changeLanguage('zh');
  useScriptStore.getState().prepare({ runId: 'test', fileName: 'demo.py', language: 'python' });
  useScriptStore.setState({ status: 'running', height: 240 });
  useProblemsStore.setState({ documents: {}, batches: {}, pendingJump: null });
  useEditorStore.setState({
    activeTabId: 'a',
    tabRenderList: [{ id: 'a', name: 'demo.py', ext: 'py' }],
    viewMode: 'edit',
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('output console', () => {
  it('does not feed identical layout or tool state back into React in StrictMode', () => {
    const warnings = vi.spyOn(console, 'error');
    const changed = vi.fn();
    const unsubscribe = useScriptStore.subscribe(changed);
    render(<React.StrictMode><OutputConsole /></React.StrictMode>);
    act(() => {
      for (let index = 0; index < 60; index += 1) {
        const state = useScriptStore.getState();
        state.setHeight(state.height);
        state.setOpen(state.open);
        state.setToolTab(state.toolTab);
      }
    });
    expect(changed).not.toHaveBeenCalled();
    act(() => useScriptStore.getState().setHeight(1000));
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '600');
    act(() => useScriptStore.getState().setHeight(1000));
    expect(changed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: /问题/ }));
    fireEvent.click(screen.getByRole('tab', { name: '输出' }));
    expect(warnings.mock.calls.flat().join(' ')).not.toMatch(/Maximum update depth|findDOMNode/);
    unsubscribe();
    warnings.mockRestore();
  });
  it('renders text output safely without taking editor focus', () => {
    const view = render(<input aria-label="编辑器" />);
    screen.getByLabelText('编辑器').focus();
    useScriptStore.getState().append('stdout', '<script>alert("x")</script>\n中文');
    view.rerender(<React.Fragment><input aria-label="编辑器" /><OutputConsole /></React.Fragment>);
    expect(screen.getByLabelText('编辑器')).toHaveFocus();
    expect(screen.getByLabelText('程序输出')).toHaveTextContent('<script>alert("x")</script>');
    expect(view.container.querySelector('script')).toBeNull();
  });
  it('does not submit an IME Enter and sends committed input', async () => {
    render(<OutputConsole />);
    const input = screen.getByLabelText('程序输入');
    fireEvent.change(input, { target: { value: '中文' } });
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true })).toBe(true);
    fireEvent.submit(input.closest('form'));
    expect(scriptRunner.sendInput).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { data: '中文' });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(scriptRunner.sendInput).toHaveBeenCalledWith('中文'));
    await waitFor(() => expect(input).toHaveValue(''));
  });
  it('can hide the console without stopping the process, and summon it back with Ctrl+J', () => {
    render(<OutputConsole />);
    fireEvent.click(screen.getByLabelText('隐藏控制台'));
    expect(screen.queryByLabelText('输出控制台')).toBeNull();
    expect(useScriptStore.getState().status).toBe('running');
    expect(scriptRunner.stop).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'J', ctrlKey: true });
    expect(screen.getByLabelText('输出控制台')).toBeTruthy();
  });
  it('stays hidden without a code editor or a supported language, ignoring summon shortcuts', () => {
    useScriptStore.getState().setOpen(false);
    useEditorStore.setState({
      activeTabId: 'b',
      tabRenderList: [
        { id: 'a', name: 'demo.py', ext: 'py' },
        { id: 'b', name: 'notes.txt', ext: 'txt' },
      ],
      viewMode: 'edit',
    });
    render(<OutputConsole />);
    expect(screen.queryByLabelText('输出控制台')).toBeNull();
    fireEvent.keyDown(window, { key: 'J', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
    expect(useScriptStore.getState().open).toBe(false);
    expect(screen.queryByLabelText('输出控制台')).toBeNull();
    // 切回受支持的文件后，快捷键可以正常呼出面板。
    act(() => useEditorStore.setState({ activeTabId: 'a', viewMode: 'edit' }));
    fireEvent.keyDown(window, { key: 'J', ctrlKey: true });
    expect(screen.getByLabelText('输出控制台')).toBeTruthy();
    // 预览模式下的树编辑器 / Milkdown 独占场景没有代码编辑器，面板同样隐藏。
    act(() => useEditorStore.setState({
      activeTabId: 'c',
      tabRenderList: [
        { id: 'a', name: 'demo.py', ext: 'py' },
        { id: 'b', name: 'notes.txt', ext: 'txt' },
        { id: 'c', name: 'demo.mgtree', ext: 'mgtree' },
      ],
      viewMode: 'preview',
    }));
    expect(screen.queryByLabelText('输出控制台')).toBeNull();
  });
  it('retains the tool window and output when switching to another file', () => {
    useEditorStore.setState({
      activeTabId: 'a',
      tabRenderList: [{ id: 'a', name: 'demo.py' }, { id: 'b', name: 'other.py' }],
    });
    render(<OutputConsole />);
    expect(screen.getByLabelText('输出控制台')).toBeTruthy();
    act(() => useEditorStore.setState({ activeTabId: 'b' }));
    expect(screen.getByLabelText('输出控制台')).toBeTruthy();
    expect(useScriptStore.getState().status).toBe('running');
    expect(scriptRunner.stop).not.toHaveBeenCalled();
  });
  it('switches output and problems, and hides the whole panel when the active tool tab is clicked again', () => {
    useScriptStore.getState().append('stdout', 'preserved output');
    render(<OutputConsole />);
    fireEvent.click(screen.getByRole('tab', { name: /问题/ }));
    expect(screen.getByRole('tabpanel', { name: /问题/ })).toBeTruthy();
    expect(screen.queryByLabelText('程序输出')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '输出' }));
    expect(screen.getByLabelText('程序输出')).toHaveTextContent('preserved output');
    fireEvent.click(screen.getByRole('tab', { name: '输出' }));
    // 收起时不再保留折叠工具条，整个面板（含标签）都隐藏。
    expect(screen.queryByLabelText('输出控制台')).toBeNull();
    expect(screen.queryByRole('tab', { name: /问题/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('tabpanel', { name: /问题/ })).toBeTruthy();
  });
  it('gives the output area to the runtime settings panel while it is open', () => {
    render(<OutputConsole />);
    expect(screen.getByLabelText('程序输出')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '运行环境' }));
    expect(screen.queryByLabelText('程序输出')).toBeNull();
    expect(screen.getByLabelText('Python 运行环境路径')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '运行环境' }));
    expect(screen.getByLabelText('程序输出')).toBeTruthy();
  });
  it('renders input inline with its prompt and preserves only the program line breaks', () => {
    const state = useScriptStore.getState();
    state.append('stdout', '第 1 次猜测，请输入数字：');
    state.append('stdin', '23\n');
    state.append('stdout', '太小了！\n\n第 2 次猜测，请输入数字：');
    const { container } = render(<OutputConsole />);
    expect(container.querySelector('.output-console__text').textContent)
      .toBe('第 1 次猜测，请输入数字：23\n太小了！\n\n第 2 次猜测，请输入数字：');
  });
  it('blocks duplicate submissions and keeps newly typed input while an earlier send completes', async () => {
    let complete;
    scriptRunner.sendInput.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render(<OutputConsole />);
    const input = screen.getByLabelText('程序输入');
    fireEvent.change(input, { target: { value: '23' } });
    fireEvent.submit(input.closest('form'));
    fireEvent.submit(input.closest('form'));
    expect(scriptRunner.sendInput).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '发送输入' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '44' } });
    await act(async () => { complete(true); });
    expect(input).toHaveValue('44');
    expect(screen.getByRole('button', { name: '发送输入' })).toBeEnabled();
    expect(fireEvent.keyDown(input, { key: 'Enter', repeat: true })).toBe(false);
  });
  it('allows a deliberate empty Enter to exit an interactive program', async () => {
    render(<OutputConsole />);
    fireEvent.submit(screen.getByLabelText('程序输入').closest('form'));
    await waitFor(() => expect(scriptRunner.sendInput).toHaveBeenCalledWith(''));
  });
  it('shows icon controls and hides the input area when the input stream is no longer available', () => {
    render(<OutputConsole />);
    expect(screen.getByLabelText('程序输入')).toBeEnabled();
    expect(screen.getByRole('button', { name: '发送输入' }).querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: '运行环境' }).querySelector('svg')).toBeTruthy();
    act(() => useScriptStore.getState().receive({ runId: 'test', kind: 'exit', exitCode: 0 }));
    expect(screen.queryByLabelText('程序输入')).toBeNull();
    expect(screen.queryByPlaceholderText('输入内容，按 Enter 发送')).toBeNull();
    expect(screen.queryByRole('button', { name: '发送输入' })).toBeNull();
  });
});
