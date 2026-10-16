import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import useUpdateStore from '@store/useUpdateStore';
import useLspStore from '@store/useLspStore';
import useEditorStore from '@store/useEditorStore';
import TaskList from './TaskList';

globalThis.React = React;
afterEach(cleanup);

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('0.1.2') }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));

beforeEach(() => {
  useUpdateStore.setState({
    stage: 'downloading',
    open: true,
    total: 100,
    downloaded: 50,
    version: '0.1.3',
    error: '',
    check: vi.fn(),
  });
  useEditorStore.setState({ tabRenderList: [] });
  // 语言服务的安装状态是跨用例共享的 store，这里清干净，避免相互串味。
  useLspStore.setState({ operations: {} });
});

it('shows real transfer progress without a modal and permits hiding while downloading', () => {
  render(<TaskList />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  fireEvent.click(screen.getByRole('button', { name: 'tasks.hide' }));
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(useUpdateStore.getState().stage).toBe('downloading');
});

it('uses indeterminate progress when the server does not provide a size', () => {
  useUpdateStore.setState({ total: 0 });
  render(<TaskList />);
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
});

it('keeps installation blocked until edited documents have been saved', () => {
  useUpdateStore.setState({ stage: 'available' });
  useEditorStore.setState({ tabRenderList: [{ id: 'draft', modified: true }] });
  render(<TaskList />);
  expect(screen.getByRole('button', { name: 'update.install' })).toBeDisabled();
  expect(screen.getByText('update.saveFirst')).toBeVisible();
});

it('exposes a failed transfer and a retry action in the task list', () => {
  const check = vi.fn();
  useUpdateStore.setState({ stage: 'error', error: 'Network lost', check });
  render(<TaskList />);
  expect(screen.getByRole('alert')).toHaveTextContent('Network lost');
  fireEvent.click(screen.getByRole('button', { name: 'update.retry' }));
  expect(check).toHaveBeenCalledWith();
});

it('任务列表默认隐藏，只有 open 时才渲染', () => {
  useUpdateStore.setState({ open: false, stage: 'downloading', downloaded: 50, total: 100 });
  render(<TaskList />);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'tasks.hide' })).not.toBeInTheDocument();
});

it('语言服务的安装也进任务列表，带百分比，用分割线上的关闭按钮取消', () => {
  const cancelInstall = vi.fn();
  // 这条只关心语言服务任务，把更新置为 idle，免得两条任务各有一个进度条。
  useUpdateStore.setState({ stage: 'idle' });
  useLspStore.setState({
    operations: { 'mde.marksman': { phase: 'downloading', percent: 30, text: '1.4 / 30.0 MB' } },
    cancelInstall,
  });
  render(<TaskList />);
  expect(screen.getByText('Markdown · Marksman')).toBeVisible();
  expect(screen.getByText('languageServices.phase.downloading')).toBeVisible();
  expect(screen.getByText('1.4 / 30.0 MB')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
  // 关闭按钮取代了原先占一整行的"取消"按钮。
  expect(screen.queryByRole('button', { name: 'languageServices.cancel' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'tasks.closeTask：Markdown · Marksman' }));
  expect(cancelInstall).toHaveBeenCalledWith('mde.marksman');
});

it('失败的安装任务用同一个关闭按钮清掉，而不是取消', () => {
  const dismissOperation = vi.fn();
  const cancelInstall = vi.fn();
  useUpdateStore.setState({ stage: 'idle' });
  useLspStore.setState({
    operations: { 'mde.jdktls': { phase: 'error', text: 'error sending request' } },
    dismissOperation,
    cancelInstall,
  });
  render(<TaskList />);
  // 状态行不能再说"安装"，否则和下面的报错自相矛盾。
  expect(screen.getByText('tasks.pluginFailed')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('error sending request');
  fireEvent.click(screen.getByRole('button', { name: 'tasks.closeTask：mde.jdktls' }));
  expect(dismissOperation).toHaveBeenCalledWith('mde.jdktls');
  expect(cancelInstall).not.toHaveBeenCalled();
});

it('有可用更新时只留安装按钮，关掉这条任务即回到空闲', () => {
  const reset = vi.fn();
  useUpdateStore.setState({ stage: 'available', version: '0.1.4', reset });
  render(<TaskList />);
  expect(screen.getByRole('button', { name: 'update.install' })).toBeVisible();
  // "稍后"由关闭按钮承担，不再单独占一行。
  expect(screen.queryByRole('button', { name: 'update.later' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /tasks\.closeTask/ }));
  expect(reset).toHaveBeenCalledOnce();
});

it('正在下载的更新不给关闭按钮（中止不了，不能假装能）', () => {
  useUpdateStore.setState({ stage: 'downloading', version: '0.1.4' });
  render(<TaskList />);
  expect(screen.queryByRole('button', { name: /tasks\.closeTask/ })).not.toBeInTheDocument();
});

it('更新与语言服务同时进行时，两条任务并列显示', () => {
  useLspStore.setState({
    operations: { 'mde.marksman': { phase: 'installing', percent: 80, text: '' } },
  });
  render(<TaskList />);
  expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  // 更新任务的标题会带上版本号（"update.title · v0.1.3"），所以用正则匹配。
  expect(screen.getByText(/update\.title/)).toBeVisible();
  expect(screen.getByText('Markdown · Marksman')).toBeVisible();
});

it('安装完成后该任务不再出现在列表里', () => {
  useLspStore.setState({
    operations: { 'mde.marksman': { phase: 'installing', percent: 100, text: '' } },
  });
  const { rerender } = render(<TaskList />);
  expect(screen.getByText('Markdown · Marksman')).toBeVisible();
  useLspStore.setState({ operations: {} });
  rerender(<TaskList />);
  expect(screen.queryByText('Markdown · Marksman')).not.toBeInTheDocument();
});
