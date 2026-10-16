import * as React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useEditorStore from '@store/useEditorStore';
import FloatingToolbar from './FloatingToolbar';

globalThis.React = React;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  // @/i18n 初始化要用它，缺了会把依赖链一起拉报错。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const POSITION_KEY = 'mokidown:floating-toolbar-position';

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState({ toolbarVisible: true });
});
afterEach(cleanup);

/**
 * 工具栏位置是持久化的，而窗口尺寸会变（最大化→还原、换显示器）。
 * 历史坐标如果落在当前视口之外，工具栏会被渲染在屏幕外面，用户看到的就是
 * "唤不出来"。所以每次唤出都必须夹回可视区。
 */
it('把越界的历史位置夹回可视区，而不是停在视口外', async () => {
  // 真实案例：这条坐标是从 app 的 LevelDB 里挖出来的，对应窗口最大化时的右下角。
  localStorage.setItem(POSITION_KEY, JSON.stringify({ x: 1451, y: 1095 }));

  render(<FloatingToolbar />);

  await waitFor(() => {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY));
    expect(saved.x).toBeLessThan(window.innerWidth);
    expect(saved.y).toBeLessThan(window.innerHeight);
  });
});

it('位置本来就在可视区内时保持不动', async () => {
  localStorage.setItem(POSITION_KEY, JSON.stringify({ x: 100, y: 100 }));

  render(<FloatingToolbar />);

  // 给它几帧时间：这个用例要证明的是「没有被多此一举地改写」
  await waitFor(() => expect(document.querySelector('.ft')).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(JSON.parse(localStorage.getItem(POSITION_KEY))).toEqual({ x: 100, y: 100 });
});
