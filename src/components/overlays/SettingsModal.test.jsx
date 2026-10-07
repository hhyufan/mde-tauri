import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { readBackgroundImage, saveBackgroundImage, deleteBackgroundImage, validateBackgroundImage } from '@utils/backgroundImage';
import i18n from '@/i18n';

globalThis.React = React;
const { default: SettingsModal } = await import('./SettingsModal');
vi.mock('@hooks/useResponsiveLayout', () => ({ useResponsiveLayout: () => ({ isMobileLayout: false, isPortrait: false }) }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => 'test') }));
vi.mock('./LanguageServices', () => ({ default: () => null }));
vi.mock('../../services/syncEngine', () => ({ default: {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), readTextFile: vi.fn(), writeTextFile: vi.fn() }));
vi.mock('@utils/backgroundImage', async (original) => ({ ...(await original()),
  readBackgroundImage: vi.fn(async () => new Blob(['image'])),
  saveBackgroundImage: vi.fn(async () => 'new-image'), deleteBackgroundImage: vi.fn(async () => {}),
  validateBackgroundImage: vi.fn(async () => {}),
}));
beforeEach(() => {
  i18n.changeLanguage('zh');
  useConfigStore.setState({ fontSize: 14, previewFontSize: 14, previewZoomSync: false });
  useConfigStore.setState({ backgroundImage: '', backgroundImageName: '', backgroundEnabled: false,
    backgroundTransparency: { light: 80, dark: 80 } });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computedStyle(element));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); delete window.__TAURI_INTERNALS__; });

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

it('imports a native image, persists its reference, previews theme-specific opacity, and removes the stored asset', async () => {
  window.__TAURI_INTERNALS__ = {};
  open.mockResolvedValue('C:\\pictures\\background.png');
  readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByText('外观'));
  fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
  await waitFor(() => expect(useConfigStore.getState().backgroundImage).toBe('new-image'));
  expect(readFile).toHaveBeenCalledWith('C:\\pictures\\background.png');
  expect(saveBackgroundImage).toHaveBeenCalledWith(expect.any(Blob));
  expect(useConfigStore.getState().backgroundEnabled).toBe(true);
  expect(useConfigStore.getState().backgroundImageName).toBe('background.png');
  expect(await screen.findByRole('img', { name: '背景预览' })).toHaveStyle({ opacity: '0.2' });
  const light = screen.getByRole('slider', { name: '浅色主题背景透明度' });
  fireEvent.keyDown(light, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
  expect(useConfigStore.getState().backgroundTransparency).toEqual({ light: 81, dark: 80 });
  act(() => useConfigStore.getState().setConfig('backgroundTransparency', { light: 100, dark: 0 }));
  fireEvent.click(screen.getByRole('button', { name: 'Light' }));
  expect(screen.getByRole('img', { name: '背景预览' })).toHaveStyle({ opacity: '0' });
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
  expect(screen.getByRole('img', { name: '背景预览' })).toHaveStyle({ opacity: '1' });
  fireEvent.click(screen.getByRole('switch', { name: '启用背景图片' }));
  expect(useConfigStore.getState().backgroundImage).toBe('new-image');
  expect(screen.getByRole('img', { name: '背景预览' })).toHaveStyle({ opacity: '0' });
  fireEvent.click(screen.getByRole('button', { name: '移除' }));
  await waitFor(() => expect(deleteBackgroundImage).toHaveBeenCalledWith('new-image'));
  expect(useConfigStore.getState().backgroundImage).toBe('');
  expect(screen.queryByRole('img', { name: '背景预览' })).toBeNull();
  expect(readBackgroundImage).toHaveBeenCalledWith('new-image');
  act(() => useThemeStore.getState().setTheme('light'));
});

it('keeps the previous background if an image cannot be decoded', async () => {
  useConfigStore.setState({ backgroundImage: 'previous', backgroundImageName: 'previous.png', backgroundEnabled: true });
  window.__TAURI_INTERNALS__ = {};
  open.mockResolvedValue('C:\\bad.png');
  readFile.mockResolvedValue(new Uint8Array([0]));
  validateBackgroundImage.mockRejectedValueOnce(new Error('Invalid image'));
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByText('外观'));
  fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
  await waitFor(() => expect(validateBackgroundImage).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: '选择图片' })).not.toHaveClass('ant-btn-loading'));
  expect(useConfigStore.getState().backgroundImage).toBe('previous');
  expect(saveBackgroundImage).not.toHaveBeenCalled();
  expect(deleteBackgroundImage).not.toHaveBeenCalled();
});
