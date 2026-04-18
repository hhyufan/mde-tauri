import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useAuthStore from '@store/useAuthStore';
import useNotificationStore from '@store/useNotificationStore';
import './login-modal.scss';

function LoginModal({ open, onClose, onLoggedIn }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, register, loading } = useAuthStore();
  const notify = useNotificationStore((s) => s.notify);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (mode === 'login') {
        await login(email, password);
        notify('success', t('auth.loginSuccess'));
      } else {
        await register(email, username, password);
        notify('success', t('auth.registerSuccess'));
      }
      onLoggedIn?.();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Error';
      notify('error', t('auth.error'), Array.isArray(msg) ? msg.join(', ') : msg);
    }
  }

  return (
    <div className="login-overlay" onClick={onClose}>
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        <button className="login-modal__close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>

        <div className="login-modal__header">
          <div className="login-modal__logo">M</div>
          <h2>{t('auth.title')}</h2>
        </div>

        <div className="login-modal__tabs">
          <button
            className={`login-modal__tab ${mode === 'login' ? 'login-modal__tab--active' : ''}`}
            onClick={() => setMode('login')}
          >
            {t('auth.login')}
          </button>
          <button
            className={`login-modal__tab ${mode === 'register' ? 'login-modal__tab--active' : ''}`}
            onClick={() => setMode('register')}
          >
            {t('auth.register')}
          </button>
        </div>

        <form className="login-modal__form" onSubmit={handleSubmit}>
          <label>
            <span>{t('auth.email')}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@example.com"
            />
          </label>

          {mode === 'register' && (
            <label>
              <span>{t('auth.username')}</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                placeholder={t('auth.usernamePlaceholder')}
              />
            </label>
          )}

          <label>
            <span>{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••"
            />
          </label>

          <button className="login-modal__submit" type="submit" disabled={loading}>
            {loading ? t('auth.loading') : mode === 'login' ? t('auth.login') : t('auth.register')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginModal;
