import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import { OfflineLogger } from '../utils/offlineLogger';

/**
 * Базова URL бекенду.
 *
 * Налаштовується через .env файл у корені проєкту:
 *   EXPO_PUBLIC_API_URL=http://192.168.x.x:3000/api
 *
 * Пріоритет:
 *   1. EXPO_PUBLIC_API_URL із .env  ← рекомендований спосіб
 *   2. Fallback на localhost        ← працює в емуляторі Android
 *
 * Для реального пристрою в одній мережі Wi-Fi:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.XX:3000/api
 * Для Android-емулятора:
 *   EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';

console.log('[Axios] API_BASE_URL:', API_BASE_URL);

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000, // 15s → збільшено для стабільності
  headers: { 'Content-Type': 'application/json' },
});

console.log('[Axios] Axios instance created:', !!api);

// ─── Server reachability tracking ──────────────────────────────────────────
let _serverReachable = true;
let _lastCheck = 0;
const CHECK_INTERVAL = 10000; // 10 секунд між перевірками

/**
 * Перевіряє доступність сервера через /health/ping
 */
export async function checkServerReachable(): Promise<boolean> {
  const now = Date.now();
  if (now - _lastCheck < CHECK_INTERVAL) {
    return _serverReachable; // Повертаємо кеш якщо перевіряли недавно
  }

  _lastCheck = now;

  try {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      _serverReachable = false;
      OfflineLogger.network('No network connection');
      return false;
    }

    // Пінгуємо сервер — URL без /api префіксу
    const pingUrl = API_BASE_URL.replace('/api', '') + '/health/ping';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(pingUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    _serverReachable = response.status === 200;
    OfflineLogger.network(`Server ping: ${_serverReachable ? 'OK' : 'FAIL'}`, { status: response.status });
    return _serverReachable;
  } catch (e) {
    _serverReachable = false;
    OfflineLogger.network('Server ping failed', { error: String(e) });
    return false;
  }
}

export function getServerReachable(): boolean {
  return _serverReachable;
}

export function setServerReachable(value: boolean): void {
  _serverReachable = value;
}

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

api.interceptors.response.use(
  (response: AxiosResponse) => {
    OfflineLogger.network('Response OK', { url: response.config.url, status: response.status });
    _serverReachable = true;
    return response;
  },
  async (error) => {
    OfflineLogger.network('Response error', {
      url: error.config?.url,
      status: error.response?.status,
      message: error.message,
    });

    // КРИТИЧНО: Якщо немає відповіді від сервера — це офлайн, НЕ редіректити на login
    if (!error.response) {
      OfflineLogger.network('No response from server — offline mode, skip auth redirect');
      _serverReachable = false;
      return Promise.reject(error);
    }

    const originalRequest = error.config;

    // Тільки якщо є реальна 401 відповідь від сервера — обробляти
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/')
    ) {
      // Якщо сервер недоступний — не робити refresh, відразу reject
      if (!_serverReachable) {
        OfflineLogger.auth('401 but server unreachable — skip refresh, stay offline');
        return Promise.reject(error);
      }
      
      // Перевірити чи є мережа взагалі
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        OfflineLogger.auth('401 but no network — staying offline, skip redirect');
        _serverReachable = false;
        return Promise.reject(error);
      }

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
      } catch (refreshError: unknown) {
        processQueue(refreshError, null);

        // 🔄 ОФЛАЙН-РЕЖИМ: Якщо сервер недоступний — не видаляємо токени,
        // щоб клієнт міг продовжити роботу з локальною БД.
        // Повне очищення токенів відбувається тільки якщо сервер ДОСТУПНИЙ
        // і підтвердив що токени недійсні (юзер заблокований / пароль змінено).
        const err = refreshError as { response?: unknown };
        if (!err?.response) {
          // Сервер недоступний — залишаємо токени для офлайн-режиму
          OfflineLogger.auth('Refresh failed — server unreachable, keeping tokens for offline mode');
          return Promise.reject(Object.assign(new Error('Offline'), { _isOffline: true }));
        }

        // Сервер доступний, але відхилив refresh — токени дійсно невалідні
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
        return Promise.reject(refreshError as Error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;