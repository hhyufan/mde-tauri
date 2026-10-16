import { expect, it, vi } from 'vitest';
import { withTooltip } from './imperativeTooltip';

it('把命令式创建的按钮包进 antd Tooltip，并保留按钮本身', async () => {
  const button = document.createElement('button');
  button.className = 'moki-table__edit';
  button.title = '旧的原生提示';
  const host = withTooltip(button, '调整表格');
  document.body.appendChild(host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // 按钮还在，且原生 title 已移除
  const found = host.querySelector('.moki-table__edit');
  expect(found).toBe(button);
  expect(button.getAttribute('title')).toBeNull();
  // Tooltip 的宿主与外层都是不产生盒子的 span
  expect(host.style.display).toBe('contents');
  const inner = host.firstElementChild;
  expect(inner?.style.display).toBe('contents');
  expect(inner?.contains(button)).toBe(true);
  host.remove();
});