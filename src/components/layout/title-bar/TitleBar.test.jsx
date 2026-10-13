import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TitleBar from './TitleBar';
import React from 'react';

const mock = vi.hoisted(() => ({
  window: { isMaximized: vi.fn(), isAlwaysOnTop: vi.fn(), onResized: vi.fn(), startDragging: vi.fn(),
    maximize: vi.fn(), unmaximize: vi.fn(), minimize: vi.fn(), setAlwaysOnTop: vi.fn() },
  desktop: true,
}));
vi.mock('@utils/tauriApi', () => ({ appWindow: mock.window }));
vi.mock('@hooks/useResponsiveLayout', () => ({ useResponsiveLayout: () => ({ isMobileLayout: !mock.desktop, isAndroid: false }) }));
vi.mock('./SearchDropdown', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('antd', () => ({ Tooltip: ({ children, title }) => <span data-tooltip={title}>{children}</span> }));

beforeEach(() => {
  vi.stubGlobal('React', React);
  mock.desktop = true;
  for (const fn of Object.values(mock.window)) fn.mockReset().mockResolvedValue(undefined);
  mock.window.isMaximized.mockResolvedValue(false);
  mock.window.onResized.mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('starts left-button drags but leaves right-clicks out of the native window layer', async () => {
  const { container } = render(<TitleBar />);
  await waitFor(() => expect(mock.window.onResized).toHaveBeenCalled());
  const drag = container.querySelector('.titlebar__drag');
  fireEvent.mouseDown(drag, { button: 2, detail: 1 });
  expect(fireEvent.contextMenu(drag)).toBe(false);
  expect(mock.window.startDragging).not.toHaveBeenCalled();
  fireEvent.mouseDown(drag, { button: 0, detail: 1 });
  expect(mock.window.startDragging).toHaveBeenCalledOnce();
});

it('preserves double-click maximize without starting another drag', async () => {
  const { container } = render(<TitleBar />);
  await waitFor(() => expect(mock.window.onResized).toHaveBeenCalled());
  fireEvent.mouseDown(container.querySelector('.titlebar__drag'), { button: 0, detail: 2 });
  expect(mock.window.maximize).toHaveBeenCalledOnce();
  expect(mock.window.startDragging).not.toHaveBeenCalled();
});

it('preserves double-click restore when the window is maximized', async () => {
  mock.window.isMaximized.mockResolvedValue(true);
  const { container } = render(<TitleBar />);
  await waitFor(() => expect(container.querySelector('[data-tooltip="topbar.unmaximize"]')).not.toBeNull());
  fireEvent.mouseDown(container.querySelector('.titlebar__drag'), { button: 0, detail: 2 });
  expect(mock.window.unmaximize).toHaveBeenCalledOnce();
});

it('does not start desktop window operations in the mobile layout', () => {
  mock.desktop = false;
  const { container } = render(<TitleBar />);
  fireEvent.mouseDown(container.querySelector('.titlebar__drag'), { button: 0, detail: 1 });
  expect(mock.window.startDragging).not.toHaveBeenCalled();
});
