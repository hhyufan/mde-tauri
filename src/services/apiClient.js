import axios from 'axios';
import useAuthStore from '@store/useAuthStore';
import useConfigStore from '@store/useConfigStore';

const DEFAULT_BASE_URL = 'https://www.miaogu.xyz';

const apiClient = axios.create({ timeout: 30000 });

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_BASE_URL;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function getApiBaseUrl() {
  const configured = useConfigStore.getState().serverUrl;
  return normalizeBaseUrl(configured);
}

export function classifyApiError(error) {
  const status = error?.response?.status || 0;
  const code = error?.code || '';
  const message = String(error?.message || '').toLowerCase();

  if (status === 401) return 'auth_required';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'request_error';

  if (message.includes('name not resolved') || message.includes('err_name_not_resolved')) {
    return 'server_unreachable';
  }
  if (message.includes('proxy_connection_failed') || message.includes('proxy')) {
    return 'offline';
  }
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED') {
    return 'offline';
  }
  return 'error';
}

apiClient.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      const { token, refreshToken, logout } = useAuthStore.getState();
      if (token && !error.config._retried) {
        error.config._retried = true;
        try {
          await refreshToken();
          error.config.headers.Authorization = `Bearer ${useAuthStore.getState().token}`;
          return apiClient(error.config);
        } catch {
          logout();
        }
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
