import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Tooltip } from 'antd';

/**
 * 给命令式创建的按钮套上 antd Tooltip。
 *
 * 表格、HTML 块这类节点视图是直接操作 DOM 建的，因此过去只能写 button.title ——
 * 那是浏览器原生提示，延迟、样式与应用的其它提示都不一致。这里沿用 TablePicker
 * 的既有做法：用 createRoot 渲染一个 Tooltip 把按钮包住。
 *
 * 注意 Tooltip 的子元素必须是 React 元素：直接塞 DOM 节点会报
 * 「Objects are not valid as a React child」。所以渲染一个 span，在 ref 回调里
 * 把已建好的按钮挂进去——ref 在提交阶段执行，此时 DOM 已经就位。
 *
 * 两层 span 都用 display: contents，自身不产生盒子，按钮原有的绝对定位与布局
 * 因此不受影响。返回宿主节点交给调用方 append；按钮上的 title 会被移除，
 * 避免原生提示与 Tooltip 同时出现。
 *
 * @param {HTMLElement} button 已经建好的按钮
 * @param {string} label 提示文案
 * @param {object} [props] 透传给 antd Tooltip 的其余属性（如 placement）
 * @returns {HTMLElement} 承载 Tooltip 的宿主节点
 */
export function withTooltip(button, label, props = {}) {
  const host = document.createElement('span');
  host.style.display = 'contents';
  button.removeAttribute('title');
  const attach = (node) => {
    if (node && button.parentElement !== node) node.appendChild(button);
  };
  createRoot(host).render(
    createElement(
      Tooltip,
      { title: label, ...props },
      createElement('span', { style: { display: 'contents' }, ref: attach }),
    ),
  );
  return host;
}
