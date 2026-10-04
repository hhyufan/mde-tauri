import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReactMarkdown from 'react-markdown';
import MarkdownCodePre from './MarkdownCodePre';
import CodeBlockExecution from './CodeBlockExecution';
import useCodeBlockRunStore from '@store/useCodeBlockRunStore';
import { scriptRunner } from '@/services/scriptRunner';
import i18n from '@/i18n';
import { codeBlockKey, rehypeCodeBlockIndexes } from '@utils/markdownCodeBlocks';
import { attachCodeBlockExecutions } from './milkdownCodeBlockRuns';

globalThis.React = React;
vi.mock('@/services/scriptRunner', async (original) => ({ ...await original(),
  scriptRunner: { runBlock: vi.fn(), stopBlock: vi.fn(), sendBlockInput: vi.fn(async () => true) },
}));
beforeEach(() => { i18n.changeLanguage('zh'); useCodeBlockRunStore.setState({ blocks: {} }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('renders controls for supported fenced blocks only and runs the exact selected source', () => {
  const markdown = ['```javascript', 'console.log("A")', '```', '```c#', 'Console.WriteLine(42);', '```',
    '```python', 'print("B")', '```', '```java', 'System.out.println(1);', '```',
    '```kotlin', 'println("C")', '```', '```go', 'fmt.Println(1)', '```', '`inline`'].join('\n\n');
  const pre = (props) => <MarkdownCodePre {...props} documentId="doc" filePath="C:/notes/example.md" fileName="example.md" />;
  render(<ReactMarkdown rehypePlugins={[rehypeCodeBlockIndexes]} components={{ pre }}>{markdown}</ReactMarkdown>);
  const buttons = screen.getAllByRole('button', { name: '运行此代码块' });
  // JavaScript / C# / Python / Java / Kotlin 有运行入口，go 与行内代码没有。
  expect(buttons).toHaveLength(5);
  fireEvent.click(buttons[1]);
  expect(scriptRunner.runBlock).toHaveBeenCalledWith(expect.objectContaining({
    key: codeBlockKey('doc', 1), language: 'csharp', source: '\nConsole.WriteLine(42);\n', filePath: 'C:/notes/example.md',
  }));
  fireEvent.click(buttons[3]);
  expect(scriptRunner.runBlock).toHaveBeenLastCalledWith(expect.objectContaining({
    key: codeBlockKey('doc', 3), language: 'java',
  }));
  expect(scriptRunner.runBlock.mock.lastCall[0].source).toContain('System.out.println(1);');
  fireEvent.click(buttons[4]);
  expect(scriptRunner.runBlock).toHaveBeenLastCalledWith(expect.objectContaining({
    key: codeBlockKey('doc', 4), language: 'kotlin',
  }));
  expect(scriptRunner.runBlock.mock.lastCall[0].source).toContain('println("C")');
});

it('keeps output beneath its own block, escapes output, and reports edited source', () => {
  const view = render(<div><CodeBlockExecution blockKey="a" language="javascript" source="A" />
    <CodeBlockExecution blockKey="b" language="python" source="B" /></div>);
  act(() => {
    const state = useCodeBlockRunStore.getState();
    state.prepare('a', { runId: 'a1', source: 'A', language: 'javascript' });
    state.receive('a', { runId: 'a1', kind: 'stdout', text: '<script>中文</script>' });
    state.receive('a', { runId: 'a1', kind: 'exit', exitCode: 0, elapsedMs: 100 });
  });
  const blocks = screen.getAllByLabelText('代码块运行');
  expect(within(blocks[0]).getByRole('log')).toHaveTextContent('<script>中文</script>');
  expect(within(blocks[1]).queryByRole('log')).toBeNull();
  expect(view.container.querySelector('script')).toBeNull();
  view.rerender(<CodeBlockExecution blockKey="a" language="javascript" source="edited A" />);
  expect(screen.getByText('代码已修改，重新运行以更新结果。')).toBeInTheDocument();
});

it('does not submit IME candidate Enter, and sends committed input to this block', async () => {
  useCodeBlockRunStore.getState().prepare('input', { runId: 'input1', source: 'input()', language: 'python' });
  useCodeBlockRunStore.getState().receive('input', { runId: 'input1', kind: 'status', text: 'started' });
  render(<CodeBlockExecution blockKey="input" language="python" source="input()" />);
  const input = screen.getByLabelText('代码块程序输入');
  fireEvent.change(input, { target: { value: '中文' } });
  fireEvent.compositionStart(input);
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
  fireEvent.submit(input.closest('form'));
  expect(scriptRunner.sendBlockInput).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.submit(input.closest('form'));
  await waitFor(() => expect(scriptRunner.sendBlockInput).toHaveBeenCalledWith('input', '中文'));
});

it('Milkdown mounts controls from document nodes and restores them after virtualization', async () => {
  const wrapper = document.createElement('div');
  const host = document.createElement('div'); host.className = 'milkdown-code-block';
  wrapper.append(host); document.body.append(wrapper);
  const node = { type: { name: 'code_block' }, attrs: { language: 'python' }, textContent: 'print("live buffer")' };
  const view = { state: { doc: { descendants: (visit) => visit(node, 0) } }, nodeDOM: () => host };
  const dispose = attachCodeBlockExecutions({ root: wrapper, getView: () => view, documentId: 'doc', filePath: 'example.md' });
  try {
    await waitFor(() => expect(host.querySelector('button')).toBeTruthy());
    fireEvent.click(host.querySelector('button'));
    expect(scriptRunner.runBlock).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'print("live buffer")' }));
    host.replaceChildren(document.createElement('pre'));
    node.textContent = 'print("changed")';
    await waitFor(() => expect(host.querySelector('button')).toBeTruthy());
    fireEvent.click(host.querySelector('button'));
    expect(scriptRunner.runBlock).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'print("changed")' }));
    expect(node.textContent).toBe('print("changed")');
  } finally { dispose(); await Promise.resolve(); wrapper.remove(); }
});

it('does not duplicate pending block input or erase the next input when it completes', async () => {
  useCodeBlockRunStore.getState().prepare('input', { runId: 'input1', source: 'input()', language: 'python' });
  useCodeBlockRunStore.getState().receive('input', { runId: 'input1', kind: 'status', text: 'started' });
  let complete;
  scriptRunner.sendBlockInput.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  render(<CodeBlockExecution blockKey="input" language="python" source="input()" />);
  const input = screen.getByLabelText('代码块程序输入');
  fireEvent.change(input, { target: { value: '23' } });
  fireEvent.submit(input.closest('form'));
  fireEvent.submit(input.closest('form'));
  expect(scriptRunner.sendBlockInput).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: '44' } });
  await act(async () => { complete(true); });
  expect(input).toHaveValue('44');
  expect(fireEvent.keyDown(input, { key: 'Enter', repeat: true })).toBe(false);
});
