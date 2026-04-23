import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Tabs, Form, Input, Button } from 'antd';
import useAuthStore from '@store/useAuthStore';
import useNotificationStore from '@store/useNotificationStore';
import './login-modal.scss';

function LoginModal({ open, onClose, onLoggedIn }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('login');
  const { login, register, loading } = useAuthStore();
  const notify = useNotificationStore((s) => s.notify);
  const [form] = Form.useForm();

  async function handleSubmit(values) {
    const { email, username, password } = values;
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
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={400}
      centered
      destroyOnClose
      maskClosable
      rootClassName="mde-login-modal-root"
    >
      <div className="login-modal__inner">
        <div className="login-modal__header">
          <div className="login-modal__logo">M</div>
          <h2>{t('auth.title')}</h2>
        </div>

        <Tabs
          activeKey={mode}
          onChange={(key) => setMode(key)}
          centered
          items={[
            { key: 'login', label: t('auth.login') },
            { key: 'register', label: t('auth.register') },
          ]}
        />

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
          autoComplete="off"
          preserve={false}
        >
          <Form.Item
            label={t('auth.email')}
            name="email"
            rules={[
              { required: true, message: t('auth.email') },
              { type: 'email', message: t('auth.email') },
            ]}
          >
            <Input placeholder="you@example.com" autoFocus />
          </Form.Item>

          {mode === 'register' && (
            <Form.Item
              label={t('auth.username')}
              name="username"
              rules={[
                { required: true, message: t('auth.username') },
                { min: 2, message: t('auth.username') },
              ]}
            >
              <Input placeholder={t('auth.usernamePlaceholder')} />
            </Form.Item>
          )}

          <Form.Item
            label={t('auth.password')}
            name="password"
            rules={[
              { required: true, message: t('auth.password') },
              { min: 6, message: t('auth.password') },
            ]}
          >
            <Input.Password placeholder="••••••" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 4 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              size="large"
            >
              {mode === 'login' ? t('auth.login') : t('auth.register')}
            </Button>
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
}

export default LoginModal;
