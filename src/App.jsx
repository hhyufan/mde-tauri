/**
 * @file 应用入口模块。
 *
 * 该文件负责组装主界面框架、全局快捷键、窗口关闭保护、拖拽投放以及
 * 各类顶层浮层的懒加载入口，是桌面端与 Web 容器共同使用的根级协调层。
 */
import { lazy, Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { appWindow, getCliArgs } from '@utils/tauriApi';
import useThemeStore from '@store/useThemeStore';
import useEditorStore from '@store/useEditorStore';
import useAuthStore from '@store/useAuthStore';
import useFileStore from '@store/useFileStore';
import useConfigStore from '@store/useConfigStore';
import { useFileManager } from '@hooks/useFileManager';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import { useViewportInsets } from '@hooks/useViewportInsets';
import { syncEngine } from '@/services/syncEngine';
import Sidebar from '@layout/sidebar/Sidebar';
import TitleBar from '@layout/title-bar/TitleBar';
import TabBar from '@layout/tab-bar/TabBar';
import EditorContent from '@layout/content/EditorContent';
import Footer from '@layout/footer/Footer';
import NotificationContainer from '@components/notification/NotificationContainer';
import useSyncStore from '@store/useSyncStore';
import { GUEST_USER_SCOPE, isOwnedByUser } from '@store/userScope';
import { cn } from '@utils/classNames';
import '@styles/App.scss';

/**
 * 应用根组件。
 *
 * 负责串起主题与认证初始化、目录恢复、全局快捷键、窗口关闭保护、
 * Tauri/浏览器双通道拖拽投放，以及所有顶层浮层的懒加载挂载。
 */
// 顶层浮层默认都不会在首屏出现，因此统一使用懒加载，避免把较重的依赖
// 提前打进入口包；其中 `StatsPanel` 还会额外引入体积较大的 `@antv/g2`。
const SearchModal = lazy(() => import('@components/overlays/SearchModal'));
const SettingsModal = lazy(() => import('@components/overlays/SettingsModal'));
const StatsPanel = lazy(() => import('@components/overlays/StatsPanel'));
const LoginModal = lazy(() => import('@components/overlays/LoginModal'));
const ConflictDialog = lazy(() => import('@components/overlays/ConflictDialog'));
const UnsavedChangesModal = lazy(() => import('@components/overlays/UnsavedChangesModal'));

const ASSOCIATED_MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mdwn', 'mkd', 'mkdn']);

/**
 * 判断命令行参数里的路径是否应当被当作 Markdown 关联文件打开。
 *
 * @param {string} path 待判断的文件路径。
 * @returns {boolean} 是否属于支持的 Markdown 关联文件。
 */
function isAssociatedMarkdownPath(path) {
  const ext = String(path || '').split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
  return ASSOCIATED_MARKDOWN_EXTENSIONS.has(ext);
}

/**
 * 根应用组件。
 *
 * 统一协调主题、认证、目录恢复、窗口事件、拖拽投放和全局弹窗状态，
 * 并渲染编辑器主布局与顶层模态层。
 */
function App() {
  const { t } = useTranslation();
  const initTheme = useThemeStore((s) => s.initTheme);
  const toggleSidebar = useEditorStore((s) => s.toggleSidebar);
  const setSidebarVisible = useEditorStore((s) => s.setSidebarVisible);
  const sidebarVisible = useEditorStore((s) => s.sidebarVisible);
  const toggleEditPreview = useEditorStore((s) => s.toggleEditPreview);
  const tabs = useEditorStore((s) => s.tabRenderList);
  const loadToken = useAuthStore((s) => s.loadToken);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const userId = useAuthStore((s) => s.user?.id || GUEST_USER_SCOPE);
  const autoSave = useConfigStore((s) => s.autoSave);
  const conflictEntries = useSyncStore((s) => s.conflicts);
  const conflicts = useMemo(
    () => conflictEntries.filter((item) => isOwnedByUser(item?.ownerUserId, userId)),
    [conflictEntries, userId],
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [windowClosePromptOpen, setWindowClosePromptOpen] = useState(false);
  const [windowCloseSaving, setWindowCloseSaving] = useState(false);
  const [selectedUnsavedTabIds, setSelectedUnsavedTabIds] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragTarget, setDragTarget] = useState(null);
  const [dragOverlayRect, setDragOverlayRect] = useState(null);
  const lastDragPositionRef = useRef(null);
  const lastDropAtRef = useRef(0);
  const allowWindowCloseRef = useRef(false);
  const cliArgsOpenedRef = useRef(false);
  const { isMobileLayout, isAndroid, isPortrait } = useResponsiveLayout();
  const isDesktopWindow = !isMobileLayout && !isAndroid;
  useViewportInsets();
  const {
    saveCurrentFile,
    saveTab,
    openFileDialog,
    openFileFromPath,
    loadDirectory,
    openDroppedPathsInEditor,
    moveDroppedPathsToExplorer,
  } = useFileManager();
  const unsavedTabs = useMemo(
    () => (autoSave ? [] : tabs.filter((tab) => tab.modified)),
    [autoSave, tabs],
  );

  /**
   * 打开未保存变更确认弹窗，并预选当前待处理标签。
   *
   * @param {Array<object>} [pendingTabs=unsavedTabs] 需要参与关闭确认的未保存标签集合。
   */
  const openUnsavedClosePrompt = useCallback((pendingTabs = unsavedTabs) => {
    setSelectedUnsavedTabIds(pendingTabs.map((tab) => tab.id));
    setWindowClosePromptOpen(true);
  }, [unsavedTabs]);

  useEffect(() => {
    // 主题与登录态会影响首屏渲染结果，因此在首次挂载时立即初始化。
    initTheme();
    loadToken();

    // 原生窗口已由 `index.html` 内联启动脚本提前显示，这里无需再次触发
    // `show_main_window`，避免重复窗口控制调用。

    // 不影响首屏可见内容的工作统一延后到浏览器空闲期执行，避免阻塞交互就绪：
    // 例如同步引擎重置、资源管理器目录恢复等。
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    idle(() => {
      syncEngine.ensureLocalReset();
      const savedDir = useFileStore.getState().currentDir;
      if (savedDir) loadDirectory(savedDir);
    });
  }, []);

  useEffect(() => {
    if (isMobileLayout) {
      setSidebarVisible(false);
    }
  }, [isMobileLayout, setSidebarVisible]);

  useEffect(() => {
    if (isLoggedIn) {
      syncEngine.fullSync();
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (cliArgsOpenedRef.current || isAndroid) return;
    cliArgsOpenedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const args = await getCliArgs();
        if (cancelled || !Array.isArray(args)) return;

        for (const path of args.filter(isAssociatedMarkdownPath)) {
          const name = path.split(/[\\/]/).pop() || path;
          await openFileFromPath(path, name);
        }
      } catch (err) {
        console.warn('[App] Failed to open associated file args:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAndroid, openFileFromPath]);

  /**
   * 处理应用级快捷键，包括搜索、保存、打开文件、侧边栏与视图切换。
   *
   * @param {KeyboardEvent} e 键盘事件对象。
   */
  const handleKeyDown = useCallback((e) => {
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'F11') {
      if (!isDesktopWindow) return;
      e.preventDefault();
      if (e.repeat) return;
      appWindow
        .isFullscreen()
        .then((isFullscreen) => appWindow.setFullscreen(!isFullscreen))
        .catch(console.error);
      return;
    }
    if (mod && e.key === 'p') {
      e.preventDefault();
      setSearchOpen(true);
    }
    if (mod && e.key === 's') {
      e.preventDefault();
      saveCurrentFile();
    }
    if (mod && e.key === 'o') {
      e.preventDefault();
      openFileDialog();
    }
    if (mod && e.key === ',') {
      e.preventDefault();
      setSettingsOpen((v) => !v);
    }
    if (mod && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
    if (mod && e.shiftKey && e.key === '/') {
      e.preventDefault();
      toggleEditPreview();
    }
    if (e.key === 'Escape') {
      setSearchOpen(false);
      setSettingsOpen(false);
      setLoginOpen(false);
    }
  }, [isDesktopWindow, saveCurrentFile, openFileDialog, toggleSidebar, toggleEditPreview]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  /**
   * 请求关闭窗口；若存在未保存标签，则先转入确认流程。
   *
   * @returns {void}
   */
  const requestWindowClose = useCallback(() => {
    if (unsavedTabs.length > 0) {
      openUnsavedClosePrompt(unsavedTabs);
      return;
    }
    if (!isDesktopWindow) return;
    allowWindowCloseRef.current = true;
    appWindow.close();
  }, [isDesktopWindow, openUnsavedClosePrompt, unsavedTabs]);

  useEffect(() => {
    if (!isDesktopWindow || typeof appWindow.onCloseRequested !== 'function') return undefined;

    const unlisten = appWindow.onCloseRequested((event) => {
      if (allowWindowCloseRef.current) return;
      const shouldPrompt = !useConfigStore.getState().autoSave
        && useEditorStore.getState().tabRenderList.some((tab) => tab.modified);
      if (!shouldPrompt) return;
      event.preventDefault();
      openUnsavedClosePrompt(useEditorStore.getState().tabRenderList.filter((tab) => tab.modified));
    });

    return () => {
      unlisten.then((fn) => fn()).catch(console.error);
    };
  }, [isDesktopWindow, openUnsavedClosePrompt]);

  /**
   * 保存已勾选的未保存标签，并在成功后继续关闭窗口。
   *
   * @returns {Promise<void>}
   */
  const handleSaveAndCloseWindow = useCallback(async () => {
    const selectedIds = new Set(selectedUnsavedTabIds);
    const tabsToSave = unsavedTabs.filter((tab) => selectedIds.has(tab.id));
    setWindowCloseSaving(true);
    for (const tab of tabsToSave) {
      const result = await saveTab(tab.id);
      if (!result?.ok) {
        setWindowCloseSaving(false);
        return;
      }
    }
    setWindowCloseSaving(false);
    if (!isDesktopWindow) {
      setWindowClosePromptOpen(false);
      return;
    }
    allowWindowCloseRef.current = true;
    appWindow.close();
  }, [isDesktopWindow, saveTab, selectedUnsavedTabIds, unsavedTabs]);

  /**
   * 放弃未保存修改并直接关闭窗口。
   *
   * @returns {void}
   */
  const handleDiscardAndCloseWindow = useCallback(() => {
    if (!isDesktopWindow) {
      setWindowClosePromptOpen(false);
      return;
    }
    allowWindowCloseRef.current = true;
    appWindow.close();
  }, [isDesktopWindow]);

  /**
   * 在关闭确认弹窗中切换某个未保存标签是否参与保存。
   *
   * @param {object} tab 待切换的标签对象。
   * @param {boolean} checked 当前复选状态。
   */
  const handleToggleUnsavedTab = useCallback((tab, checked) => {
    setSelectedUnsavedTabIds((prev) => {
      if (checked) {
        return prev.includes(tab.id) ? prev : [...prev, tab.id];
      }
      return prev.filter((id) => id !== tab.id);
    });
  }, []);

  /**
   * 根据拖拽坐标判断当前命中的投放区域，并返回对应高亮矩形。
   *
   * @param {{x?: number, y?: number}|null} position 当前拖拽坐标。
   * @returns {{target: 'explorer'|'editor', rect: DOMRect}|null} 命中的投放区域与高亮矩形。
   */
  const getDropRegion = useCallback((position) => {
    if (!position) return null;
    const rawX = position.x ?? 0;
    const rawY = position.y ?? 0;
    const scale = window.devicePixelRatio || 1;
    // Tauri 原生拖拽事件在高 DPI 屏幕上可能给出物理像素，而浏览器命中测试
    // 依赖 CSS 像素，因此这里在必要时做一次兜底换算。
    const x = rawX > window.innerWidth && scale > 1 ? rawX / scale : rawX;
    const y = rawY > window.innerHeight && scale > 1 ? rawY / scale : rawY;
    const target = document.elementFromPoint(x, y);
    const explorer = target?.closest('.file-tree');
    if (explorer) {
      const rect = explorer.getBoundingClientRect();
      return { target: 'explorer', rect };
    }

    const editor = target?.closest('.editor-content');
    if (editor) {
      const rect = editor.getBoundingClientRect();
      return { target: 'editor', rect };
    }

    return null;
  }, []);

  useEffect(() => {
    if (isMobileLayout || isAndroid) return undefined;

    let disposed = false;
    const unlisteners = [];

    /**
     * 收集异步注册成功后的解绑函数，统一放到卸载阶段回收。
     *
     * @param {Promise<Function>} promise Tauri 事件监听注册 Promise。
     */
    const register = (promise) => {
      promise
        .then((handler) => {
          if (disposed) {
            handler();
          } else {
            unlisteners.push(handler);
          }
        })
        .catch(console.error);
    };

    /**
     * 根据最近一次拖拽事件刷新覆盖层高亮与命中区域状态。
     *
     * @param {{position?: {x?: number, y?: number}}} [payload={}] 拖拽事件负载。
     */
    const updateDragState = (payload = {}) => {
      const position = payload.position || lastDragPositionRef.current;
      if (position) {
        lastDragPositionRef.current = position;
        const region = getDropRegion(position);
        setDragTarget(region?.target || null);
        setDragOverlayRect(region?.rect || null);
      }
      setIsDragOver(true);
    };

    // 拖拽监听不会影响首屏展示，因此延迟到空闲期再注册，避免一批 Tauri IPC
    // `listen` 调用抢占首屏交互时间。
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    let cancelled = false;
    const idleHandle = idle(() => {
      if (cancelled || disposed) return;
      registerListeners();
    });

    /**
     * 注册桌面端与浏览器两条拖拽事件通路，并将结果汇聚到统一投放逻辑。
     */
    function registerListeners() {
    // Tauri 原生窗口拖拽事件负责桌面端文件拖入；浏览器事件分支兜底 H5
    // 与部分 WebView 场景，两条通路最终都汇聚到同一套区域判定逻辑。
    register(listen('tauri://drag-enter', (event) => {
      updateDragState(event.payload);
    }));

    register(listen('tauri://drag-over', (event) => {
      updateDragState(event.payload);
    }));

    register(listen('tauri://drag-leave', () => {
      setIsDragOver(false);
      setDragTarget(null);
      setDragOverlayRect(null);
      lastDragPositionRef.current = null;
    }));

    register(listen('tauri://drag-drop', async (event) => {
      setIsDragOver(false);
      setDragTarget(null);
      setDragOverlayRect(null);
      const payload = event.payload || {};
      if (!payload.paths?.length) return;
      const now = Date.now();
      if (now - lastDropAtRef.current < 300) return;
      lastDropAtRef.current = now;

      const region = getDropRegion(payload.position || lastDragPositionRef.current);
      lastDragPositionRef.current = null;
      if (region?.target === 'explorer') {
        await moveDroppedPathsToExplorer(payload.paths);
      } else if (region?.target === 'editor') {
        await openDroppedPathsInEditor(payload.paths);
      }
    }));

    if (typeof window !== 'undefined') {
      const handleDragOver = (event) => {
        event.preventDefault();
        updateDragState({ position: { x: event.clientX, y: event.clientY } });
      };
      const handleDrop = async (event) => {
        event.preventDefault();
        setIsDragOver(false);
        const files = Array.from(event.dataTransfer?.files || []);
        const paths = files.map((file) => file.path).filter(Boolean);
        if (!paths.length) return;
        const now = Date.now();
        if (now - lastDropAtRef.current < 300) return;
        lastDropAtRef.current = now;

        setDragTarget(null);
        setDragOverlayRect(null);
        const region = getDropRegion({ x: event.clientX, y: event.clientY });
        if (region?.target === 'explorer') {
          await moveDroppedPathsToExplorer(paths);
        } else if (region?.target === 'editor') {
          await openDroppedPathsInEditor(paths);
        }
      };
      const handleDragLeave = (event) => {
        if (event.clientX <= 0 || event.clientY <= 0) {
          setIsDragOver(false);
          setDragTarget(null);
          setDragOverlayRect(null);
          lastDragPositionRef.current = null;
        }
      };

      window.addEventListener('dragover', handleDragOver);
      window.addEventListener('drop', handleDrop);
      window.addEventListener('dragleave', handleDragLeave);
      unlisteners.push(() => {
        window.removeEventListener('dragover', handleDragOver);
        window.removeEventListener('drop', handleDrop);
        window.removeEventListener('dragleave', handleDragLeave);
      });
    }
    } // end registerListeners

    return () => {
      cancelled = true;
      disposed = true;
      if (window.cancelIdleCallback && typeof idleHandle === 'number') {
        window.cancelIdleCallback(idleHandle);
      }
      unlisteners.forEach((handler) => handler());
    };
  }, [
    getDropRegion,
    isAndroid,
    isMobileLayout,
    moveDroppedPathsToExplorer,
    openDroppedPathsInEditor,
  ]);

  const dragOverlayTitle = dragTarget === 'explorer'
    ? t('drag.explorerTitle', '移动到资源管理器')
    : t('drag.editorTitle', '打开到新标签页');
  const dragOverlayHint = dragTarget === 'explorer'
    ? t('drag.explorerHint', '松开后移动到当前资源管理器目录，并打开文件')
    : t('drag.editorHint', '松开后只打开文件，不切换资源管理器目录');

  return (
    <>
      <div
        className={cn(
          'app',
          isDragOver && 'app--drag-over',
          isMobileLayout && 'app--mobile',
          isAndroid && 'app--android',
          isPortrait && 'app--portrait',
        )}
      >
        <Sidebar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenStats={() => setStatsOpen(true)}
          onOpenLogin={() => setLoginOpen(true)}
        />
        {isMobileLayout && sidebarVisible && (
          <button
            className="app__sidebar-backdrop"
            type="button"
            aria-label={t('topbar.toggleSidebar')}
            onClick={() => setSidebarVisible(false)}
          />
        )}
        <div className="app__main">
          <TitleBar
            onOpenSearch={() => setSearchOpen(true)}
            onRequestClose={requestWindowClose}
          />
          <TabBar />
          <EditorContent />
          <Footer />
        </div>
        {isDragOver && dragTarget && dragOverlayRect && (
          <div
            className={`drag-overlay drag-overlay--${dragTarget}`}
            style={{
              left: dragOverlayRect.left,
              top: dragOverlayRect.top,
              width: dragOverlayRect.width,
              height: dragOverlayRect.height,
            }}
          >
            <div className="drag-overlay__content">
              <svg className="drag-overlay__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 19h14" />
              </svg>
              <div className="drag-overlay__title">{dragOverlayTitle}</div>
              <div className="drag-overlay__hint">{dragOverlayHint}</div>
            </div>
          </div>
        )}
      </div>
      <Suspense fallback={null}>
        {searchOpen && <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />}
        {settingsOpen && <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
        {statsOpen && <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} />}
        {loginOpen && <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onLoggedIn={() => syncEngine.fullSync()} />}
        {conflicts.length > 0 && (
          <ConflictDialog
            open
            conflicts={conflicts}
            onResolve={(fileId, resolution) => syncEngine.resolveConflict(fileId, resolution)}
            onClose={() => {}}
          />
        )}
        {windowClosePromptOpen && (
          <UnsavedChangesModal
            open={windowClosePromptOpen}
            tabs={unsavedTabs}
            selectedTabIds={selectedUnsavedTabIds}
            onToggleTab={handleToggleUnsavedTab}
            onSaveSelected={handleSaveAndCloseWindow}
            onDiscard={handleDiscardAndCloseWindow}
            onCancel={() => setWindowClosePromptOpen(false)}
            loading={windowCloseSaving}
          />
        )}
      </Suspense>
      <NotificationContainer />
    </>
  );
}

export default App;
