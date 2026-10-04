/**
 * ?????????
 *
 * ?????????????????????????????????????
 */
import { create } from 'zustand';
import apiClient from '@/services/apiClient';
import {
  deleteRefreshCredential,
  getRefreshCredential,
  setRefreshCredential,
} from '@utils/tauriApi';

let tauriStore = null;
let restoringSession = null;
let refreshingSession = null;
let sessionRevision = 0;

/**
 * 懒加载 Tauri 持久化存储实例。
 *
 * 浏览器开发环境下该插件可能不存在，因此读取逻辑都放在运行时兜底。
 */
function getTauriStore() {
  if (!tauriStore) {
    tauriStore = import('@tauri-apps/plugin-store').then(({ load }) => load('auth.json')).catch((error) => {
      tauriStore = null;
      throw error;
    });
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

  // 失效凭据只做本地清理；再次请求 /auth/logout 会产生无意义的 401。
  clearSession: async () => {
    sessionRevision += 1;
    set({ user: null, token: null, isLoggedIn: false });
    await Promise.allSettled([
      deleteRefreshCredential(),
      (async () => {
        const store = await getTauriStore();
        await store.delete('token');
        await store.delete('user');
        await store.save();
      })(),
    ]);
  },

  /**
   * 启动时从本地存储恢复会话。
   */
  loadToken: () => {
    if (get().isLoggedIn) return Promise.resolve();
    // StrictMode 重放初始化 effect 时共享同一个恢复任务，避免刷新令牌轮换两次。
    if (restoringSession) return restoringSession;
    const revision = sessionRevision;
    restoringSession = (async () => {
      try {
        const store = await getTauriStore();
        const user = await store.get('user');
        if (user && revision === sessionRevision) await get().refreshToken();
      } catch {
        // 浏览器开发环境可能没有 Tauri store；网络暂时不可用时保留本地凭据。
      }
    })().finally(() => { restoringSession = null; });
    return restoringSession;
  },

  /**
   * 使用邮箱密码登录，并把会话写入本地存储。
   */
  login: async (email, password) => {
    sessionRevision += 1;
    set({ loading: true });
    try {
      const { data } = await apiClient.post('/auth/login', { email, password });
      set({ user: data.user, token: data.access_token, isLoggedIn: true, loading: false });
      const store = await getTauriStore();
      await store.set('user', data.user);
      await store.save();
      await setRefreshCredential(data.refreshToken);
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
    sessionRevision += 1;
    set({ loading: true });
    try {
      const { data } = await apiClient.post('/auth/register', { email, username, password });
      set({ user: data.user, token: data.access_token, isLoggedIn: true, loading: false });
      const store = await getTauriStore();
      await store.set('user', data.user);
      await store.save();
      await setRefreshCredential(data.refreshToken);
      return data;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  /**
   * 合并并发刷新；凭据失效时清理会话，网络故障则保留凭据供重试。
   */
  refreshToken: () => {
    const revision = sessionRevision;
    if (refreshingSession?.revision === revision) return refreshingSession.promise;
    const task = { revision, promise: null };
    task.promise = (async () => {
      try {
        const refreshCredential = await getRefreshCredential();
        if (!refreshCredential) {
          const error = new Error('Missing refresh credential');
          error.code = 'MISSING_REFRESH_CREDENTIAL';
          throw error;
        }
        if (revision !== sessionRevision) throw new Error('Authentication session changed');
        const { data } = await apiClient.post('/auth/refresh', { refreshToken: refreshCredential });
        if (revision !== sessionRevision) throw new Error('Authentication session changed');
        const store = await getTauriStore();
        if (revision !== sessionRevision) throw new Error('Authentication session changed');
        await store.set('user', data.user);
        await store.save();
        if (revision !== sessionRevision) throw new Error('Authentication session changed');
        await setRefreshCredential(data.refreshToken);
        if (revision !== sessionRevision) throw new Error('Authentication session changed');
        set({ token: data.access_token, user: data.user, isLoggedIn: true });
      } catch (error) {
        if (revision === sessionRevision && (error.response?.status === 401
          || error.response?.status === 403 || error.code === 'MISSING_REFRESH_CREDENTIAL')) {
          await get().clearSession();
        }
        throw error;
      }
    })().finally(() => {
      if (refreshingSession === task) refreshingSession = null;
    });
    refreshingSession = task;
    return task.promise;
  },

  /**
   * 清空内存态与本地存储中的认证信息。
   */
  logout: async () => {
    // Revoke the in-memory session first so in-flight sync work cannot enqueue
    // more authenticated requests while remote credential cleanup is pending.
    const credential = getRefreshCredential().catch(() => null);
    await get().clearSession();
    try {
      const refreshCredential = await credential;
      if (refreshCredential) await apiClient.post('/auth/logout', { refreshToken: refreshCredential });
    } catch {
      // Local logout still proceeds if revocation cannot reach the server.
    }
  },
}));

export default useAuthStore;
