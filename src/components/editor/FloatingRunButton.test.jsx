import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import useScriptStore from '@store/useScriptStore';
import { scriptRunner } from '@/services/scriptRunner';
import i18n from '@/i18n';
import FloatingRunButton from './FloatingRunButton';

globalThis.React = React;
vi.mock('@/hooks/useResponsiveLayout', () => ({ useResponsiveLayout: () => ({ isAndroid: false }) }));
vi.mock('@/services/scriptRunner', async (original) => ({
  ...await original(), scriptRunner: { runCurrent: vi.fn(), stop: vi.fn() },
}));
beforeEach(() => { i18n.changeLanguage('zh'); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows the editor run button for supported files, and stops a running script', () => {
  useScriptStore.setState({ status: 'idle' });
  useEditorStore.setState({ activeTabId: 'test', tabRenderList: [{ id: 'test', name: 'demo.CS' }] });
  render(<FloatingRunButton />);
  fireEvent.click(screen.getByRole('button', { name: '运行当前脚本' }));
  expect(scriptRunner.runCurrent).toHaveBeenCalledOnce();
  useScriptStore.setState({ status: 'running' });
  // Refresh React's external-store subscription before checking the button.
  cleanup(); render(<FloatingRunButton />);
  fireEvent.click(screen.getByRole('button', { name: '停止运行当前脚本' }));
  expect(scriptRunner.stop).toHaveBeenCalledOnce();
});

it('hides the floating button for documents without a local runner', () => {
  useScriptStore.setState({ status: 'idle' });
  useEditorStore.setState({ activeTabId: 'test', tabRenderList: [{ id: 'test', name: 'README.md' }] });
  render(<FloatingRunButton />);
  expect(screen.queryByRole('button')).toBeNull();
});
