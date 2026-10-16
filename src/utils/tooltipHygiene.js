/**
 * 收起「光标已经不在触发元素上」却还开着的 tooltip。
 *
 * antd 的 Tooltip 只监听触发元素自己的 mouseleave。以下情况都不会触发它，
 * 于是提示就赖在屏幕上：
 *   - 触发元素被拖走，或布局变化让它自己离开了光标
 *   - 弹出模态框等浮层盖上来
 *   - 滚动 / 缩放导致元素移出光标位置
 *
 * 处理办法：在这些时刻，向「光标下最内层的元素」派发一次 mouseout
 * （relatedTarget 指向 body）。React 的 onMouseLeave 是基于 mouseout 加公共祖先
 * 判定的，所以在最内层元素上派发一次，它的所有祖先——包括 antd 的触发元素——
 * 都会收到 mouseleave，antd 就会正常收起提示。
 * 这个做法有测试覆盖（tooltipHygiene.test.jsx）。
 */

/** 光标下最内层的元素，由 pointerover / mouseover 持续更新。 */
let hoveredElement = null;

function rememberHover(event) {
  const target = event.target;
  hoveredElement = target instanceof Element ? target : null;
}

/** `:hover` 链兜底：万一没记录到（例如安装在悬停之后），浏览器里还能查出来。 */
function hoveredChain(doc) {
  try {
    return Array.from(doc.querySelectorAll(':hover'));
  } catch {
    return [];
  }
}

/**
 * 把当前还开着的 tooltip 收掉。
 *
 * @param {{ doc?: Document, hovered?: Element[] }} [options] 便于测试注入
 * @returns {number} 实际派发出去的 mouseout 数量
 */
export function dismissStaleTooltips({ doc = document, hovered } = {}) {
  // 没有提示开着时直接返回：这个函数会挂在 scroll / wheel 这类高频事件上。
  if (!doc?.querySelector?.('.ant-tooltip')) return 0;
  const targets = hovered ?? (hoveredElement ? [hoveredElement] : hoveredChain(doc));
  let dispatched = 0;
  for (const element of targets) {
    if (!element || element === doc.body || element === doc.documentElement) continue;
    element.dispatchEvent(new MouseEvent('mouseout', {
      bubbles: true,
      cancelable: true,
      relatedTarget: doc.body,
    }));
    dispatched += 1;
  }
  return dispatched;
}

/**
 * 安装全局的 tooltip 清理：在「光标与触发元素的关系已经失效」的时刻收掉提示。
 *
 * @param {Window} [target] 默认 window；便于测试替换
 * @returns {() => void} 卸载函数
 */
export function installTooltipHygiene(target = window) {
  const doc = target.document;
  const run = () => dismissStaleTooltips({ doc });
  const passive = { capture: true, passive: true };
  doc.addEventListener('pointerover', rememberHover, true);
  doc.addEventListener('mouseover', rememberHover, true);
  target.addEventListener('blur', run);
  target.addEventListener('resize', run);
  doc.addEventListener('pointerdown', run, true);
  doc.addEventListener('scroll', run, passive);
  doc.addEventListener('wheel', run, passive);
  return () => {
    doc.removeEventListener('pointerover', rememberHover, true);
    doc.removeEventListener('mouseover', rememberHover, true);
    target.removeEventListener('blur', run);
    target.removeEventListener('resize', run);
    doc.removeEventListener('pointerdown', run, true);
    doc.removeEventListener('scroll', run, passive);
    doc.removeEventListener('wheel', run, passive);
  };
}
