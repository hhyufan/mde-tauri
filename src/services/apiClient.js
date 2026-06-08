/**
 * API ??????
 *
 * ???? Axios ??????????????????????????
 */
import axios from 'axios';
import useAuthStore from '@store/useAuthStore';
import useConfigStore from '@store/useConfigStore';

const DEFAULT_BASE_URL = 'https://www.miaogu.xyz';

/**
 * Axios API 客户端。
 *
 * 负责规范化服务端地址、注入认证头、禁用同步接口 GET 缓存，以及在
 * 401 时尝试刷新令牌后自动重放请求。
 */
const apiClient = axios.create({ timeout: 30000 });

/**
 * 把用户输入的服务器地址规整成可直接给 axios 使用的 baseURL。
 */
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

/**
 * 归类接口错误，供同步引擎决定 UI 状态与重试策略。
 */
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

/**
 * ??????
 *
 * ?????? baseURL????????????????
 */
apiClient.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (
    typeof config.url === 'string' &&
    config.url.startsWith('/sync/') &&
    String(config.method || 'get').toLowerCase() === 'get'
  ) {
    // 同步查询必须永远命中最新服务端状态，否则增量 cursor 和冲突判定
    // 会被中间层缓存污染。
    config.headers['Cache-Control'] = 'no-cache, no-store, max-age=0';
    config.headers.Pragma = 'no-cache';
    config.headers.Expires = '0';
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
