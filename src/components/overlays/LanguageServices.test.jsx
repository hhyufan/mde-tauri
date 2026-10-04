import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import i18n from '@/i18n';
import LanguageServices from './LanguageServices';
import useLspStore, { LANGUAGE_PLUGIN_CATALOG } from '@store/useLspStore';
globalThis.React = React;

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock('@utils/tauriApi', () => ({ openExternal: vi.fn() }));
afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage('en');
  window.__TAURI_INTERNALS__ = {};
  useLspStore.setState({ enabled: true, installed: [], catalog: [], sources: [], preferred: {}, operations: {}, statuses: {}, loading: false, loadError: '' });
  invoke.mockReset(); invoke.mockResolvedValue([]);
});
it('shows a searchable marketplace and an empty installed view', async () => {
  render(<LanguageServices />);
  expect(screen.getByText('JavaScript & TypeScript')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search languages, services or publishers'), { target: { value: 'rust' } });
  expect(screen.getByText('Rust · rust-analyzer')).toBeInTheDocument();
  expect(screen.queryByText('JavaScript & TypeScript')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Installed/ }));
  expect(screen.getByText('No matching language services')).toBeInTheDocument();
  await waitFor(() => expect(useLspStore.getState().loading).toBe(false));
});
it('renders brand language icons and an equal split for JavaScript & TypeScript', async () => {
  render(<LanguageServices />);
  await waitFor(() => expect(document.querySelector('svg[class="@Python"]')).toBeTruthy(), { timeout: 8000 });
  expect(document.querySelector('svg[class="@Rust"]')).toBeTruthy();
  // JS 与 TS 各占一半、等大并排（官方 devicon 图标），JS 居左、TS 居右。
  const combo = document.querySelector('.language-services__icon--combo');
  const [jsIcon, tsIcon] = combo.querySelectorAll('img');
  // 测试环境下 SVG 被内联为 data URI，用官方图标的标志色识别二者。
  expect(jsIcon.getAttribute('src').toLowerCase()).toContain('f0db4f');
  expect(tsIcon.getAttribute('src').toLowerCase()).toContain('007acc');
  expect(jsIcon.getAttribute('width')).toBe(tsIcon.getAttribute('width'));
  expect(jsIcon.getAttribute('height')).toBe(tsIcon.getAttribute('height'));
  // 无映射的自定义插件仍回退到字母徽标。
  act(() => useLspStore.getState().addManifest({
    id: 'custom.abc', name: 'ABC Server', languages: ['abc'],
    install: { kind: 'npm', packages: ['abc-server'], executable: 'abc-server' },
  }));
  expect(screen.getByText('AB')).toBeInTheDocument();
});
it('downloads a selected service, exposes its details, disables it and uninstalls it', async () => {
  const manifest = LANGUAGE_PLUGIN_CATALOG.find((plugin) => plugin.id === 'mde.rust');
  render(<LanguageServices />);
  await waitFor(() => expect(useLspStore.getState().loading).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /Rust · rust-analyzer/ }));
  invoke.mockResolvedValueOnce({ manifest, enabled: true, installedVersion: '2026-09-28' });
  fireEvent.click(screen.getByRole('button', { name: /Install$/ }));
  await screen.findByRole('button', { name: /Uninstall$/ });
  expect(screen.getByText('2026-09-28')).toBeInTheDocument();
  invoke.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole('button', { name: /Disable$/ }));
  await screen.findByRole('button', { name: /Enable$/ });
  invoke.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole('button', { name: /Uninstall$/ }));
  await screen.findByRole('button', { name: /Install$/ });
  expect(useLspStore.getState().installed).toEqual([]);
});
