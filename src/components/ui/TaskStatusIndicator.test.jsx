import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TaskStatusIndicator from './TaskStatusIndicator';

globalThis.React = React;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
afterEach(cleanup);

const ring = () => document.querySelector('.task-status-indicator__ring');

it('keeps the current task visible in the status bar and reopens its collapsed panel', () => {
  const onClick = vi.fn();
  const { rerender } = render(
    <TaskStatusIndicator stage="downloading" expanded={false} onClick={onClick} />,
  );
  const button = screen.getByRole('button', { name: 'tasks.downloading' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
  rerender(<TaskStatusIndicator stage="installing" expanded onClick={onClick} />);
  expect(screen.getByRole('button', { name: 'tasks.installing' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  // 非进行中的阶段回到通用标题与列表图标，不显示圆环。
  rerender(<TaskStatusIndicator stage="error" expanded onClick={onClick} />);
  expect(screen.getByRole('button', { name: 'tasks.title' })).toBeVisible();
  expect(ring()).not.toBeInTheDocument();
});

it('检测更新时显示"正在检测更新"，而不是回退到通用标题', () => {
  render(<TaskStatusIndicator stage="checking" expanded={false} onClick={() => {}} />);
  const button = screen.getByRole('button', { name: 'tasks.checking' });
  expect(button).toBeVisible();
  expect(ring()).toBeInTheDocument();
});

it('没有确定进度时圆环转圈（不确定态）', () => {
  render(<TaskStatusIndicator stage="installing" onClick={() => {}} />);
  expect(ring().classList.contains('is-indeterminate')).toBe(true);
  expect(ring().getAttribute('role')).toBeNull();
});

it('有百分比时圆环给出确定进度，并把百分比写进无障碍属性', () => {
  render(<TaskStatusIndicator stage="downloading" progress={42} label="下载中 42%" onClick={() => {}} />);
  const svg = ring();
  expect(svg.classList.contains('is-indeterminate')).toBe(false);
  expect(svg.getAttribute('role')).toBe('progressbar');
  expect(svg.getAttribute('aria-valuenow')).toBe('42');
  // 进度弧按比例收缩：42% 时还剩 58% 的弧长没画出来
  const [track, value] = svg.querySelectorAll('circle');
  const circumference = Number(track.getAttribute('r')) * 2 * Math.PI;
  expect(Number(value.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.58, 1);
});

it('label 由调用方给出时优先使用（语言服务阶段用的是 languageServices 文案）', () => {
  render(<TaskStatusIndicator stage="extracting" label="正在解压 Marksman" onClick={() => {}} />);
  expect(screen.getByRole('button', { name: '正在解压 Marksman' })).toBeVisible();
});
