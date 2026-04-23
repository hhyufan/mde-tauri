import { useState, useCallback } from 'react';
import { Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import useAuthStore from '@store/useAuthStore';
import { syncEngine } from '@/services/syncEngine';
import './user-menu.scss';

function UserMenu({ onOpenLogin }) {
  const { t } = useTranslation();
  const { user, isLoggedIn, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const close = useCallback(() => setMenuOpen(false), []);

  if (!isLoggedIn) {
    return (
      <button className="user-menu__login-btn" onClick={onOpenLogin}>
        {t('auth.login')}
      </button>
    );
  }

  const renderDropdown = () => (
    <div className="user-menu__dropdown">
      <div className="user-menu__email">{user?.email}</div>
      <button
        className="user-menu__item"
        onClick={() => { syncEngine.fullSync(); close(); }}
      >
        {t('sync.syncNow')}
      </button>
      <button
        className="user-menu__item user-menu__item--danger"
        onClick={() => { logout(); close(); }}
      >
        {t('auth.logout')}
      </button>
    </div>
  );

  return (
    <div className="user-menu">
      <Dropdown
        open={menuOpen}
        onOpenChange={setMenuOpen}
        trigger={['click']}
        placement="topLeft"
        arrow={false}
        popupRender={renderDropdown}
      >
        <button className="user-menu__trigger" type="button">
          <span className="user-menu__avatar">
            {user?.avatar ? (
              <img src={user.avatar} alt="" />
            ) : (
              <span className="user-menu__avatar-letter">
                {(user?.username || 'U')[0].toUpperCase()}
              </span>
            )}
          </span>
          <span className="user-menu__name">{user?.username}</span>
        </button>
      </Dropdown>
    </div>
  );
}

export default UserMenu;
