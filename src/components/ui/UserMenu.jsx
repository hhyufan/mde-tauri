import { useState, useCallback } from 'react';
import { Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import useAuthStore from '@store/useAuthStore';
import useConfigStore from '@store/useConfigStore';
import { syncEngine } from '@/services/syncEngine';
import './user-menu.scss';

/**
 * 侧边栏底部用户菜单。
 *
 * 未登录时显示登录入口；已登录时展示头像、邮箱、手动同步与退出登录操作。
 */
function UserMenu({ onOpenLogin }) {
  const { t } = useTranslation();
  const { user, isLoggedIn, logout } = useAuthStore();
  const syncEnabled = useConfigStore((s) => s.syncEnabled);
  const [menuOpen, setMenuOpen] = useState(false);

  const close = useCallback(() => setMenuOpen(false), []);

  // 本地优先：云同步总开关关闭时，登录与账号入口整块不渲染。
  if (!syncEnabled) return null;

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
