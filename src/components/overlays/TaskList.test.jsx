import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import useUpdateStore from '@store/useUpdateStore';
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
