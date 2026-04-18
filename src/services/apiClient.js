import axios from 'axios';
import useAuthStore from '@store/useAuthStore';

const BASE_URL = 'https://www.miaogu.xyz';

const apiClient = axios.create({ timeout: 30000 });

apiClient.interceptors.request.use((config) => {
  config.baseURL = BASE_URL;
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
