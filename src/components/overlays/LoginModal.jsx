/**
 * 登录弹窗模块。
 *
 * 负责承载登录与注册双模式表单，统一处理认证动作、成功回调与错误通知，
 * 为需要账号能力的界面提供独立认证入口。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Tabs, Form, Input, Button } from 'antd';
import useAuthStore from '@store/useAuthStore';
import useNotificationStore from '@store/useNotificationStore';
import './login-modal.scss';

/**
 * 登录/注册弹窗。
 *
 * 通过页签切换登录与注册模式，复用同一套表单提交流程和通知反馈。
 *
 * @param {object} props 组件属性。
 * @param {boolean} props.open 控制弹窗显示状态。
 * @param {() => void} props.onClose 关闭弹窗的回调。
 * @param {() => void} [props.onLoggedIn] 登录成功后的附加回调。
 */
function LoginModal({ open, onClose, onLoggedIn }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('login');
  const { login, register, loading } = useAuthStore();
  const notify = useNotificationStore((s) => s.notify);
  const [form] = Form.useForm();

  /**
   * 根据当前模式提交登录或注册请求，并在成功后关闭弹窗。
   *
   * @param {{ email: string, username?: string, password: string }} values 表单提交值。
   * @returns {Promise<void>} 认证流程结束后反馈结果。
   */
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
      destroyOnHidden
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
          validateTrigger="onSubmit"
        >
          <Form.Item
            label={t('auth.email')}
            name="email"
            rules={[
              { required: true, message: t('auth.emailRequired') },
              { type: 'email', message: t('auth.emailInvalid') },
            ]}
          >
            <Input placeholder="you@example.com" autoFocus />
          </Form.Item>

          {mode === 'register' && (
            <Form.Item
              label={t('auth.username')}
              name="username"
              rules={[
                { required: true, message: t('auth.usernameRequired') },
                { min: 2, message: t('auth.usernameTooShort') },
              ]}
            >
              <Input placeholder={t('auth.usernamePlaceholder')} />
            </Form.Item>
          )}

          <Form.Item
            label={t('auth.password')}
            name="password"
            rules={[
              { required: true, message: t('auth.passwordRequired') },
              { min: 6, message: t('auth.passwordTooShort') },
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
