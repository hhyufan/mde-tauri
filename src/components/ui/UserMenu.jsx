import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '@store/useAuthStore';
import { syncEngine } from '@/services/syncEngine';
import './user-menu.scss';

function UserMenu({ onOpenLogin }) {
  const { t } = useTranslation();
  const { user, isLoggedIn, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (menuOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ left: rect.left, top: rect.top });
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const close = useCallback(() => setMenuOpen(false), []);

  if (!isLoggedIn) {
    return (
      <button className="user-menu__login-btn" onClick={onOpenLogin}>
        {t('auth.login')}
      </button>
    );
  }

  return (
    <div className="user-menu">
      <button
        ref={triggerRef}
        className="user-menu__trigger"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <span className="user-menu__avatar">
          {user?.avatar ? (
            <img src={user.avatar} alt="" />
          ) : (
            <span className="user-menu__avatar-letter">{(user?.username || 'U')[0].toUpperCase()}</span>
          )}
        </span>
        <span className="user-menu__name">{user?.username}</span>
      </button>

      {menuOpen && pos && createPortal(
        <div
          ref={dropdownRef}
          className="user-menu__dropdown"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: 'translateY(-100%) translateY(-6px)',
            zIndex: 9999,
          }}
        >
          <div className="user-menu__email">{user?.email}</div>
          <button className="user-menu__item" onClick={() => { syncEngine.fullSync(); close(); }}>
            {t('sync.syncNow')}
          </button>
          <button className="user-menu__item user-menu__item--danger" onClick={() => { logout(); close(); }}>
            {t('auth.logout')}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

export default UserMenu;
