import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import useConfigStore from '@store/useConfigStore';
import i18n from '@/i18n';

globalThis.React = React;
const { default: SettingsModal } = await import('./SettingsModal');
vi.mock('@hooks/useResponsiveLayout', () => ({ useResponsiveLayout: () => ({ isMobileLayout: false, isPortrait: false }) }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => 'test') }));
vi.mock('./LanguageServices', () => ({ default: () => null }));
vi.mock('../../services/syncEngine', () => ({ default: {} }));
beforeEach(() => {
  i18n.changeLanguage('zh');
  useConfigStore.setState({ fontSize: 14, previewFontSize: 14, previewZoomSync: false });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computedStyle(element));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('adjusts both font sizes with compact controls without deprecated InputNumber addons', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => render(<React.StrictMode><SettingsModal open onClose={vi.fn()} /></React.StrictMode>));
  fireEvent.click(screen.getByText('外观'));
  expect(screen.getByRole('spinbutton', { name: '预览字号' })).toHaveValue('14');
  fireEvent.click(screen.getByRole('button', { name: '预览字号 +' }));
  expect(useConfigStore.getState().previewFontSize).toBe(15);
  act(() => useConfigStore.setState({ previewZoomSync: true }));
  expect(screen.getByRole('button', { name: '预览字号 +' })).toBeDisabled();
  expect(screen.getByRole('spinbutton', { name: '预览字号' })).toBeDisabled();
  fireEvent.click(screen.getByText('编辑器'));
  fireEvent.click(screen.getByRole('button', { name: '编辑区字号 −' }));
  expect(useConfigStore.getState().fontSize).toBe(13);
  act(() => useConfigStore.setState({ fontSize: 24 }));
  fireEvent.click(screen.getByRole('button', { name: '编辑区字号 +' }));
  expect(useConfigStore.getState().fontSize).toBe(24);
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/addonAfter|addonBefore|findDOMNode|Maximum update depth/);
});
