/**
 * ?????????
 *
 * ?????????????????????????????????????
 */
import { create } from 'zustand';
import apiClient from '@/services/apiClient';

let tauriStore = null;

/**
 * 懒加载 Tauri 持久化存储实例。
 *
 * 浏览器开发环境下该插件可能不存在，因此读取逻辑都放在运行时兜底。
 */
async function getTauriStore() {
  if (!tauriStore) {
    const { load } = await import('@tauri-apps/plugin-store');
    tauriStore = await load('auth.json');
  }
  return tauriStore;
}

/**
 * 认证会话 store。
 *
 * 负责登录、注册、刷新令牌和本地凭据持久化，是前端鉴权状态的唯一入口。
 */
const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  isLoggedIn: false,
  loading: false,

  /**
   * 启动时从本地存储恢复会话。
   */
  loadToken: async () => {
    try {
      const store = await getTauriStore();
      const token = await store.get('token');
      const user = await store.get('user');
      if (token && user) {
        set({ token, user, isLoggedIn: true });
      }
    } catch {
      // 开发中的浏览器环境可能没有 Tauri store，这里静默降级。
    }
  },

  /**
   * 使用邮箱密码登录，并把会话写入本地存储。
   */
  login: async (email, password) => {
    set({ loading: true });
    try {
      const { data } = await apiClient.post('/auth/login', { email, password });
      set({ user: data.user, token: data.access_token, isLoggedIn: true, loading: false });
      const store = await getTauriStore();
      await store.set('token', data.access_token);
      await store.set('user', data.user);
      await store.save();
      return data;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  /**
   * 注册成功后直接建立登录态，复用同一套持久化流程。
   */
  register: async (email, username, password) => {
    set({ loading: true });
    try {
      const { data } = await apiClient.post('/auth/register', { email, username, password });
      set({ user: data.user, token: data.access_token, isLoggedIn: true, loading: false });
      const store = await getTauriStore();
      await store.set('token', data.access_token);
      await store.set('user', data.user);
      await store.save();
      return data;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  /**
   * 刷新访问令牌；失败时主动登出，避免继续使用失效凭据。
   */
  refreshToken: async () => {
    try {
      const { data } = await apiClient.post('/auth/refresh');
      set({ token: data.access_token, user: data.user });
      const store = await getTauriStore();
      await store.set('token', data.access_token);
      await store.set('user', data.user);
      await store.save();
    } catch {
      get().logout();
    }
  },

  /**
   * 清空内存态与本地存储中的认证信息。
   */
  logout: async () => {
    set({ user: null, token: null, isLoggedIn: false });
    try {
      const store = await getTauriStore();
      await store.delete('token');
      await store.delete('user');
      await store.save();
    } catch {
      // 持久层清理失败不影响前端立即退出登录态。
    }
  },
}));

export default useAuthStore;
