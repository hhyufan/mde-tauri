/**
 * @file 编辑器内容区模块。
 *
 * 该文件负责在 Monaco、Markdown 所见即所得和只读预览之间切换，并集中
 * 处理排版缩放、分栏拖拽与自动保存触发等工作区级交互。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import MonacoEditor from '@components/editor/LazyMonacoEditor';
import FloatingToolbar from '@components/editor/FloatingToolbar';
import ToastContainer from '@components/ui/Toast';
import { useFileManager } from '@hooks/useFileManager';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import './editor-content.scss';

// Markdown 相关渲染器保持在懒加载边界之后，确保非 Markdown 文件仍然走
// 轻量的 Monaco 路径；纯预览模式使用可编辑的所见即所得，分栏预览则只读。
const MilkdownMarkdownEditor = lazy(() => import('@components/editor/MilkdownMarkdownEditor'));
const MarkdownPreview = lazy(() => import('@components/editor/MarkdownPreview'));

/**
 * Markdown 预览懒加载期间的占位节点。
 *
 * @returns {JSX.Element} 占据预览区尺寸的空白占位元素。
 */
const PreviewFallback = () => (
  <div style={{ flex: 1, minHeight: 0 }} />
);

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 24;
// 触控板捏合通常会被浏览器转换成一串 `deltaY` 很小的滚轮事件，这里通过
// 累积阈值平滑缩放，避免字号在每个微小刻度上抖动；普通鼠标滚轮仍可立即生效。
const WHEEL_ZOOM_THRESHOLD = 24;
const WHEEL_ZOOM_RESET_MS = 250;
const ZOOM_AREA_EDITOR = 'editor';
const ZOOM_AREA_PREVIEW = 'preview';
const ZOOM_TARGET_BOTH = 'both';

/**
 * 编辑器主工作区。
 *
 * 根据当前标签与视图模式在 Monaco、Milkdown 预览和分栏模式之间切换，
 * 并统一承接缩放、拖拽分栏与自动保存触发等高频交互。
 */
/**
 * 将字号限制在允许范围内，避免缩放结果超出配置边界。
 *
 * @param {number} value 待限制的字号值。
 * @returns {number} 落在允许范围内的字号。
 */
function clampFontSize(value) {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, value));
}

/**
 * 读取目标区域当前的字号与行高，作为缩放计算基准。
 *
 * @param {'editor'|'preview'} [area=ZOOM_AREA_EDITOR] 需要读取排版配置的区域。
 * @returns {{currentFontSize: number, currentLineHeight: number}} 当前字号与行高。
 */
function getTypographyState(area = ZOOM_AREA_EDITOR) {
  const state = useConfigStore.getState();
  const isPreview = area === ZOOM_AREA_PREVIEW;
  const currentFontSize = isPreview
    ? state.previewFontSize || state.fontSize || DEFAULT_FONT_SIZE
    : state.fontSize || DEFAULT_FONT_SIZE;
  const currentLineHeight = isPreview
    ? state.previewLineHeight || state.lineHeight || DEFAULT_LINE_HEIGHT
    : state.lineHeight || DEFAULT_LINE_HEIGHT;

  return {
    currentFontSize,
    currentLineHeight,
  };
}

/**
 * 维持当前行高比例，推导目标字号对应的排版参数。
 *
 * @param {number} targetFontSize 目标字号。
 * @param {'editor'|'preview'} [area=ZOOM_AREA_EDITOR] 需要推导的目标区域。
 * @returns {{fontSize: number, lineHeight: number}} 与字号匹配的排版配置。
 */
function computeTypographyForSize(targetFontSize, area = ZOOM_AREA_EDITOR) {
  const { currentFontSize, currentLineHeight } = getTypographyState(area);
  const lineHeightRatio = currentLineHeight / currentFontSize;
  const nextFontSize = clampFontSize(targetFontSize);

  return {
    fontSize: nextFontSize,
    lineHeight: Math.round(nextFontSize * lineHeightRatio),
  };
}

/**
 * 生成一次缩放操作需要写回配置的字段集合。
 *
 * @param {'editor'|'preview'|'both'} target 缩放目标区域。
 * @param {number} targetFontSize 目标字号。
 * @returns {object} 需要写回配置中心的排版字段。
 */
function buildTypographyUpdate(target, targetFontSize) {
  if (target === ZOOM_TARGET_BOTH) {
    const editorTypography = computeTypographyForSize(targetFontSize, ZOOM_AREA_EDITOR);
    const previewTypography = computeTypographyForSize(targetFontSize, ZOOM_AREA_PREVIEW);

    return {
      fontSize: editorTypography.fontSize,
      lineHeight: editorTypography.lineHeight,
      previewFontSize: previewTypography.fontSize,
      previewLineHeight: previewTypography.lineHeight,
    };
  }

  const typography = computeTypographyForSize(targetFontSize, target);
  return target === ZOOM_AREA_PREVIEW
    ? {
      previewFontSize: typography.fontSize,
      previewLineHeight: typography.lineHeight,
    }
    : {
      fontSize: typography.fontSize,
      lineHeight: typography.lineHeight,
    };
}

/**
 * 基于当前字号与步进值，推导下一次缩放需要写回的配置字段。
 *
 * @param {'editor'|'preview'|'both'} target 缩放目标区域。
 * @param {number} delta 相对当前字号的增量。
 * @returns {object} 下一次缩放应提交的配置更新。
 */
function getNextTypographyUpdate(target, delta) {
  const { currentFontSize } = getTypographyState(target === ZOOM_TARGET_BOTH ? ZOOM_AREA_EDITOR : target);
  return buildTypographyUpdate(target, currentFontSize + delta);
}

/**
 * 根据事件命中元素判断缩放应落到编辑区还是预览区。
 *
 * @param {EventTarget|null} target 触发缩放事件的命中节点。
 * @returns {'editor'|'preview'|null} 解析出的缩放区域。
 */
function resolveZoomArea(target) {
  if (!(target instanceof Element)) return null;
  if (target.closest('.editor-content__preview')) return ZOOM_AREA_PREVIEW;
  if (target.closest('.editor-content__editor')) return ZOOM_AREA_EDITOR;
  return null;
}

/**
 * 在 Markdown 分栏、纯编辑与纯预览场景间解析最终缩放目标。
 *
 * @param {EventTarget|null} target 触发缩放事件的命中节点。
 * @param {{viewMode: string, isMarkdown: boolean}} options 当前视图模式与文件类型信息。
 * @returns {'editor'|'preview'|'both'} 最终采用的缩放目标。
 */
function resolveZoomTarget(target, { viewMode, isMarkdown }) {
  if (!isMarkdown) return ZOOM_AREA_EDITOR;
  if (viewMode === 'preview') return ZOOM_AREA_PREVIEW;
  if (viewMode !== 'split') return ZOOM_AREA_EDITOR;

  const { previewZoomSync = true } = useConfigStore.getState();
  if (previewZoomSync) return ZOOM_TARGET_BOTH;

  return resolveZoomArea(target) || ZOOM_AREA_EDITOR;
}

/**
 * 编辑器主内容组件。
 *
 * 根据当前文件类型与视图模式渲染编辑区、预览区或分栏布局，并监听缩放、
 * 触控手势和分栏拖拽等主工作区行为。
 */
function EditorContent() {
  const { t } = useTranslation();
  const tabs = useEditorStore((s) => s.tabRenderList);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const viewMode = useEditorStore((s) => s.viewMode);
  const previewZoomSync = useConfigStore((s) => s.previewZoomSync ?? true);
  const monacoRef = useRef(null);
  const previewRef = useRef(null);
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [previewSyncHandle, setPreviewSyncHandle] = useState(null);
  const setConfig = useConfigStore((s) => s.setConfig);
  const { triggerAutoSave } = useFileManager();
  const { isMobileLayout } = useResponsiveLayout();
  const activeTabMeta = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId],
  );
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(activeTabMeta?.name || '');
  const handlePreviewRef = useCallback((instance) => {
    previewRef.current = instance;
    setPreviewSyncHandle((current) => (current === instance ? current : instance));
  }, []);

  /**
   * 响应浮动工具栏插入动作，优先走编辑器原生能力，失败时回退到通用插入。
   *
   * @param {object} action 工具栏发出的插入或包裹动作描述。
   */
  const handleToolbarInsert = useCallback((action) => {
    const editor = monacoRef.current;
    if (!editor) return;

    if (typeof editor.handleToolbarAction === 'function' && editor.handleToolbarAction(action)) {
      return;
    }

    if (action.type === 'insert') {
      editor.insertText(action.text);
    } else if (action.type === 'wrap') {
      editor.wrapSelection(action.before, action.after);
    }
  }, []);

  // 分栏分隔条统一使用 Pointer Events，让桌面鼠标拖拽与移动端触摸拖拽
  // 共用同一套实现。`setPointerCapture` 对触摸场景尤其关键，否则手指离开
  // 分隔条命中区域后，Android Chrome 往往会停止派发 `pointermove`。
  //
  // 移动端纵向布局时，编辑区与预览区上下堆叠，因此要改为使用 `clientY`
  // 与容器高度计算比例，而不是桌面横向布局下的 `clientX` 与宽度。
  /**
   * 启动分栏分隔条拖拽，并按布局方向实时更新编辑区与预览区占比。
   *
   * @param {PointerEvent} e 分隔条上的指针按下事件。
   */
  const handleDividerPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const dividerEl = e.currentTarget;
    const vertical = isMobileLayout; // column layout when true → drag vertically
    isDragging.current = true;
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    try {
      dividerEl.setPointerCapture(e.pointerId);
    } catch (_) {
      // 分隔条节点若已脱离文档，`setPointerCapture` 可能抛错；即便失败，
      // 拖拽仍可继续，只是手指移出原始目标后的稳定性会差一些。
    }

    const onPointerMove = (moveEvt) => {
      if (!isDragging.current || !containerRef.current) return;
      if (moveEvt.pointerId !== e.pointerId) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = vertical
        ? (moveEvt.clientY - rect.top) / rect.height
        : (moveEvt.clientX - rect.left) / rect.width;
      setSplitRatio(Math.max(0.15, Math.min(0.85, ratio)));
    };

    const stop = (endEvt) => {
      if (endEvt && endEvt.pointerId !== e.pointerId) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        dividerEl.releasePointerCapture(e.pointerId);
      } catch (_) {
        // 浏览器可能已在 `pointerup` 时自动释放捕获，这里直接忽略即可。
      }
      dividerEl.removeEventListener('pointermove', onPointerMove);
      dividerEl.removeEventListener('pointerup', stop);
      dividerEl.removeEventListener('pointercancel', stop);
    };

    dividerEl.addEventListener('pointermove', onPointerMove);
    dividerEl.addEventListener('pointerup', stop);
    dividerEl.addEventListener('pointercancel', stop);
  }, [isMobileLayout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const applyTypography = (update) => {
      Object.entries(update).forEach(([key, value]) => {
        setConfig(key, value);
      });
    };

    // 鼠标滚轮与触控板捏合同属滚轮通道处理。浏览器会把触控板捏合翻译成
    // `ctrlKey=true` 且 `deltaY` 很小的连续事件，因此要做阈值累积，避免
    // 缩放过程抖动或一次手势跳太多档。
    let wheelAccumulator = 0;
    let wheelResetTimer = null;

    const handleWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;

      event.preventDefault();
      event.stopPropagation();

      wheelAccumulator += event.deltaY;
      if (wheelResetTimer) clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(() => {
        wheelAccumulator = 0;
        wheelResetTimer = null;
      }, WHEEL_ZOOM_RESET_MS);

      if (Math.abs(wheelAccumulator) < WHEEL_ZOOM_THRESHOLD) return;

      const step = wheelAccumulator > 0 ? -1 : 1;
      const zoomTarget = resolveZoomTarget(event.target, { viewMode, isMarkdown });
      wheelAccumulator = 0;
      applyTypography(getNextTypographyUpdate(zoomTarget, step));
    };

    // 触屏双指缩放单独走手势距离比例推导，避免把连续手势强行离散成滚轮步进，
    // 从而减轻移动端缩放时的跳变感。
    let pinchInitialDistance = 0;
    let pinchInitialFontSize = 0;
    let pinchLastAppliedSize = 0;
    let isPinching = false;
    let pinchZoomTarget = ZOOM_AREA_EDITOR;

    const getTouchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const handleTouchStart = (event) => {
      if (event.touches.length !== 2) return;
      const distance = getTouchDistance(event.touches);
      if (distance <= 0) return;

      isPinching = true;
      pinchInitialDistance = distance;
      pinchZoomTarget = resolveZoomTarget(event.target, { viewMode, isMarkdown });
      pinchInitialFontSize = getTypographyState(
        pinchZoomTarget === ZOOM_TARGET_BOTH ? ZOOM_AREA_EDITOR : pinchZoomTarget
      ).currentFontSize;
      pinchLastAppliedSize = pinchInitialFontSize;
    };

    const handleTouchMove = (event) => {
      if (!isPinching || event.touches.length !== 2) return;
      const distance = getTouchDistance(event.touches);
      if (distance <= 0) return;

      event.preventDefault();
      event.stopPropagation();

      const scale = distance / pinchInitialDistance;
      const nextSize = clampFontSize(Math.round(pinchInitialFontSize * scale));
      if (nextSize === pinchLastAppliedSize) return;

      pinchLastAppliedSize = nextSize;
      applyTypography(buildTypographyUpdate(pinchZoomTarget, nextSize));
    };

    const handleTouchEnd = (event) => {
      if (event.touches.length < 2) {
        isPinching = false;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      if (wheelResetTimer) clearTimeout(wheelResetTimer);
      container.removeEventListener('wheel', handleWheel, { capture: true });
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isMarkdown, setConfig, viewMode]);

  useEffect(() => {
    if (viewMode !== 'split' || !isMarkdown || !previewZoomSync) return undefined;

    const editor = monacoRef.current?.getEditor?.();
    const previewEl = previewSyncHandle?.getScrollContainer?.();
    if (!editor || !previewEl) return undefined;

    let syncRaf = 0;
    const syncScroll = () => {
      syncRaf = 0;
      const editorViewportHeight = editor.getLayoutInfo?.().height || 0;
      const editorScrollable = Math.max(0, (editor.getScrollHeight?.() || 0) - editorViewportHeight);
      const previewScrollable = Math.max(0, previewEl.scrollHeight - previewEl.clientHeight);

      if (editorScrollable <= 0 || previewScrollable <= 0) {
        previewEl.scrollTop = 0;
        return;
      }

      const ratio = Math.max(0, Math.min(1, (editor.getScrollTop?.() || 0) / editorScrollable));
      previewEl.scrollTop = ratio * previewScrollable;
    };

    const scheduleSync = () => {
      if (syncRaf) cancelAnimationFrame(syncRaf);
      syncRaf = requestAnimationFrame(syncScroll);
    };

    const scrollDisposable = editor.onDidScrollChange?.(() => {
      scheduleSync();
    });

    const mutationObserver = new MutationObserver(() => {
      scheduleSync();
    });
    mutationObserver.observe(previewEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    scheduleSync();

    return () => {
      if (syncRaf) cancelAnimationFrame(syncRaf);
      scrollDisposable?.dispose?.();
      mutationObserver.disconnect();
    };
  }, [activeTabId, isMarkdown, previewSyncHandle, previewZoomSync, viewMode]);

  if (!activeTabMeta) {
    return (
      <main className={`editor-content ${isMobileLayout ? 'editor-content--mobile' : ''}`}>
        <div className="editor-content__empty">
          <div className="editor-content__empty-logo">M</div>
          <div className="editor-content__empty-title">{t('editor.empty.title')}</div>
          <div className="editor-content__empty-hint">{t('editor.empty.hint')}</div>
        </div>
      </main>
    );
  }

  return (
    <main className={`editor-content ${isMobileLayout ? 'editor-content--mobile' : ''}`}>
      <ToastContainer />
      <div
        className={`editor-content__workspace ${viewMode === 'split' && isMobileLayout ? 'editor-content__workspace--mobile-split' : ''}`}
        ref={containerRef}
        style={viewMode === 'split' ? { '--split-ratio': `${splitRatio * 100}%` } : undefined}
      >
        {viewMode === 'edit' && (
          <MonacoEditor
            key={activeTabId}
            ref={monacoRef}
            className="editor-content__editor"
            onAutoSave={triggerAutoSave}
          />
        )}
        {viewMode === 'preview' && isMarkdown && (
          <Suspense fallback={<PreviewFallback />}>
            <MilkdownMarkdownEditor
              key={activeTabId}
              ref={monacoRef}
              className="editor-content__preview editor-content__editor--milkdown"
              onAutoSave={triggerAutoSave}
            />
          </Suspense>
        )}
        {viewMode === 'split' && isMarkdown && (
          <>
            <MonacoEditor
              key={`${activeTabId}-split`}
              ref={monacoRef}
              className="editor-content__editor editor-content__editor--half"
              onAutoSave={triggerAutoSave}
            />
            <Tooltip title={t('editor.splitDivider')} placement="top" mouseEnterDelay={0.5}>
              <div
                className="editor-content__split-divider"
                onPointerDown={handleDividerPointerDown}
              />
            </Tooltip>
            <Suspense fallback={<PreviewFallback />}>
              <MarkdownPreview
                ref={handlePreviewRef}
                className="editor-content__preview editor-content__preview--half"
              />
            </Suspense>
          </>
        )}
        {!isMarkdown && viewMode !== 'edit' && (
          <MonacoEditor
            key={`${activeTabId}-fallback`}
            ref={monacoRef}
            className="editor-content__editor"
            onAutoSave={triggerAutoSave}
          />
        )}

        <div className="editor-content__fade" />
      </div>

      {/* 浮动工具栏放在工作区外层，避免被内部 `overflow: hidden` 裁切。 */}
      {isMarkdown && (
        <FloatingToolbar onInsert={handleToolbarInsert} />
      )}
    </main>
  );
}

export default EditorContent;
