import { create } from 'zustand';
import apiClient from '@/services/apiClient';

let tauriStore = null;
async function getTauriStore() {
  if (!tauriStore) {
    const { load } = await import('@tauri-apps/plugin-store');
    tauriStore = await load('auth.json');
  }
  return tauriStore;
}

const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  isLoggedIn: false,
  loading: false,

  loadToken: async () => {
    try {
      const store = await getTauriStore();
      const token = await store.get('token');
      const user = await store.get('user');
      if (token && user) {
        set({ token, user, isLoggedIn: true });
      }
    } catch {
      // Tauri store not available (e.g. in browser dev)
    }
  },

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

  logout: async () => {
    set({ user: null, token: null, isLoggedIn: false });
    try {
      const store = await getTauriStore();
      await store.delete('token');
      await store.delete('user');
      await store.save();
    } catch {
      // ignore
    }
  },
}));

export default useAuthStore;
