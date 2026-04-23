import { useEffect, useState, useCallback, useMemo } from 'react';
import { showMainWindow } from '@utils/tauriApi';
import useThemeStore from '@store/useThemeStore';
import useEditorStore from '@store/useEditorStore';
import useAuthStore from '@store/useAuthStore';
import useFileStore from '@store/useFileStore';
import { useFileManager } from '@hooks/useFileManager';
import { syncEngine } from '@/services/syncEngine';
import Sidebar from '@layout/sidebar/Sidebar';
import TitleBar from '@layout/title-bar/TitleBar';
import TabBar from '@layout/tab-bar/TabBar';
import EditorContent from '@layout/content/EditorContent';
import Footer from '@layout/footer/Footer';
import SearchModal from '@components/overlays/SearchModal';
import SettingsModal from '@components/overlays/SettingsModal';
import StatsPanel from '@components/overlays/StatsPanel';
import LoginModal from '@components/overlays/LoginModal';
import ConflictDialog from '@components/overlays/ConflictDialog';
import NotificationContainer from '@components/notification/NotificationContainer';
import useSyncStore from '@store/useSyncStore';
import { GUEST_USER_SCOPE, isOwnedByUser } from '@store/userScope';
import '@styles/App.scss';

function App() {
  const initTheme = useThemeStore((s) => s.initTheme);
  const toggleSidebar = useEditorStore((s) => s.toggleSidebar);
  const toggleEditPreview = useEditorStore((s) => s.toggleEditPreview);
  const loadToken = useAuthStore((s) => s.loadToken);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const userId = useAuthStore((s) => s.user?.id || GUEST_USER_SCOPE);
  const conflictEntries = useSyncStore((s) => s.conflicts);
  const conflicts = useMemo(
    () => conflictEntries.filter((item) => isOwnedByUser(item?.ownerUserId, userId)),
    [conflictEntries, userId],
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const { saveCurrentFile, openFileDialog, loadDirectory } = useFileManager();

  useEffect(() => {
    initTheme();
    loadToken();
    syncEngine.ensureLocalReset();
    showMainWindow().catch(console.error);

    // currentDir is persisted across restarts, but the file listing (files[])
    // is not — it's volatile OS state. Re-load the directory silently so the
    // explorer tree is populated immediately without the user having to manually
    // refresh or re-open the folder.
    const savedDir = useFileStore.getState().currentDir;
    if (savedDir) {
      loadDirectory(savedDir);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      syncEngine.fullSync();
    }
  }, [isLoggedIn]);

  const handleKeyDown = useCallback((e) => {
    const mod = e.ctrlKey || e.metaKey;

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
  }, [saveCurrentFile, openFileDialog, toggleSidebar, toggleEditPreview]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <div className="app">
        <Sidebar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenStats={() => setStatsOpen(true)}
          onOpenLogin={() => setLoginOpen(true)}
        />
        <div className="app__main">
          <TitleBar onOpenSearch={() => setSearchOpen(true)} />
          <TabBar />
          <EditorContent />
          <Footer />
        </div>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onLoggedIn={() => syncEngine.fullSync()} />
      <ConflictDialog
        open={conflicts.length > 0}
        conflicts={conflicts}
        onResolve={(fileId, resolution) => syncEngine.resolveConflict(fileId, resolution)}
        onClose={() => {}}
      />
      <NotificationContainer />
    </>
  );
}

export default App;
