import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import * as SecureStore from 'expo-secure-store';

/**
 * Базова URL бекенду.
 *
 * Налаштовується через .env файл у корені проєкту:
 * EXPO_PUBLIC_API_URL=http://192.168.x.x:3000/api
 *
 * Пріоритет:
 * 1. EXPO_PUBLIC_API_URL із .env ← рекомендований спосіб
 * 2. Fallback на localhost ← працює в емуляторі Android
 *
 * Для реального пристрою в одній мережі Wi-Fi:
 * EXPO_PUBLIC_API_URL=http://192.168.1.XX:3000/api
 * Для Android-емулятора:
 * EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';

console.log('[Axios] API_BASE_URL:', API_BASE_URL);

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 4000, // 4s → швидкий fallback до офлайн-БД
  headers: { 'Content-Type': 'application/json' },
});

console.log('[Axios] Axios instance created:', !!api);

// ─── Request interceptor: attach Bearer token ──────────────────────────────
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await SecureStore.getItemAsync('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ─── Response interceptor: auto-refresh on 401 ────────────────────────────
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failedQueue = [];
};

// ─── Глобальний прапор доступності сервера ───────────────────────────────
// NetInfo перевіряє Google, а не наш сервер. isServerReachable відстежує
// реальний стан бекенду через результати наших API-запитів.
export let isServerReachable = true;

api.interceptors.response.use(
  (response: AxiosResponse) => {
    isServerReachable = true; // будь-яка успішна відповідь = сервер живий
    return response;
  },
  async (error) => {
    if (!error.response) {
      // Network Error або timeout — сервер недоступний (не просто інтернет)
      isServerReachable = false;
    }
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await SecureStore.getItemAsync('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');

        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefreshToken } = response.data;

        await SecureStore.setItemAsync('accessToken', accessToken);
        await SecureStore.setItemAsync('refreshToken', newRefreshToken);

        processQueue(null, accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// Іменований експорт (для сумісності з sync.service.ts)
export const axiosInstance = api;

export default api;