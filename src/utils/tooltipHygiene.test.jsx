/**
 * tooltipHygiene 的测试。
 *
 * 关键点：antd 的 Tooltip 是非受控的，光靠 CSS 压一帧它会立刻弹回来，
 * 所以必须确认「派发 mouseout 真的能让它关闭」这件事成立——基线用例先证明
 * 「打开/关闭」的判断是有效的，再验证我们的清理能关掉它。
 */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Tooltip } from 'antd';
import { dismissStaleTooltips, installTooltipHygiene } from './tooltipHygiene';

globalThis.React = React;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
afterEach(cleanup);

const popupHidden = () => {
  const el = document.querySelector('.ant-tooltip');
  if (!el) return true;
  if (el.classList.contains('ant-tooltip-hidden')) return true;
  return getComputedStyle(el).display === 'none' || getComputedStyle(el).opacity === '0';
};

function openTooltip() {
  render(
    <Tooltip title="提示">
      <button type="button" data-testid="target"><span>目标</span></button>
    </Tooltip>,
  );
  const trigger = screen.getByTestId('target');
  fireEvent.mouseEnter(trigger);
  return trigger;
}

it('基线：mouseEnter 打开、mouseLeave 关闭（证明判断有效）', async () => {
  const trigger = openTooltip();
  await waitFor(() => expect(popupHidden()).toBe(false));
  fireEvent.mouseLeave(trigger);
  await waitFor(() => expect(popupHidden()).toBe(true));
});

it('在最内层子元素上派发 mouseout 就能让祖先的提示收掉', async () => {
  const trigger = openTooltip();
  await waitFor(() => expect(popupHidden()).toBe(false));

  // 光标停在触发按钮内部的 span 上——真实场景里最内层元素往往不是触发元素本身
  const inner = trigger.querySelector('span');
  expect(dismissStaleTooltips({ hovered: [inner] })).toBe(1);

  await waitFor(() => expect(popupHidden()).toBe(true));
});

it('没有提示开着时是无操作', () => {
  expect(dismissStaleTooltips()).toBe(0);
});

it('安装后，滚动 / 按下 / 失焦都会收掉还开着的提示', async () => {
  const uninstall = installTooltipHygiene(window);
  try {
    const trigger = openTooltip();
    await waitFor(() => expect(popupHidden()).toBe(false));
    // 让模块记住光标位置：这里是"安装在悬停之后"，靠 :hover 兜底
    fireEvent.mouseOver(trigger.querySelector('span'));

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(popupHidden()).toBe(true));
  } finally {
    uninstall();
  }
});

it('卸载之后这些事件不再有副作用', async () => {
  const uninstall = installTooltipHygiene(window);
  uninstall();

  openTooltip();
  await waitFor(() => expect(popupHidden()).toBe(false));

  fireEvent.pointerDown(document.body);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(popupHidden()).toBe(false);
});
