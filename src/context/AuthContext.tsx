import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '../api/auth.api';
import { checkServerReachable } from '../api/axios';
import { OfflineLogger } from '../utils/offlineLogger';
import { User, SystemRole, ClearanceLevel } from '../types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Чи підтверджений email поточного користувача */
  emailVerified: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Оновити стан emailVerified після успішної верифікації */
  setEmailVerified: (value: boolean) => void;
}

interface RegisterData {
  email: string;
  password: string;
  fullName: string;
  phoneNumber?: string;
  systemRole?: SystemRole; // ← виправлено: поле тепер є
}

const AuthContext = createContext<AuthContextValue | null>(null);
const CACHED_USER_KEY = 'cachedUser';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
    emailVerified: false,
  });

  // ─── Bootstrap: check stored token on app start ────────────────────────
  useEffect(() => {
    const loadUserOnStartup = async () => {
      OfflineLogger.auth('loadUserOnStartup called');

      // 1. Перевірити чи є збережений токен локально
      const savedToken = await SecureStore.getItemAsync('accessToken');
      if (!savedToken) {
        OfflineLogger.auth('No saved token — user not logged in');
        setState((s) => ({ ...s, isLoading: false }));
        return;
      }

      OfflineLogger.auth('Found saved token, checking server...');

      // 2. Якщо сервер недоступний — використати кешованого юзера
      const serverOk = await checkServerReachable();
      if (!serverOk) {
        OfflineLogger.auth('Server unreachable — loading cached user');
        const cachedUserJson = await AsyncStorage.getItem(CACHED_USER_KEY);
        if (cachedUserJson) {
          try {
            const cachedUser = JSON.parse(cachedUserJson);
            OfflineLogger.auth('Loaded cached user for offline', { id: cachedUser.id });
            setState({
              user: cachedUser,
              accessToken: savedToken,
              isLoading: false,
              isAuthenticated: true,
              emailVerified: false,
            });
            return;
          } catch (e) {
            OfflineLogger.auth('Failed to parse cached user', { error: String(e) });
          }
        }
        OfflineLogger.auth('No cached user — staying unauthenticated offline');
        setState((s) => ({ ...s, isLoading: false }));
        return;
      }

      // 3. Сервер доступний — завантажити юзера з API
      try {
        const user = await authApi.getMe();
        const verified = await SecureStore.getItemAsync('emailVerified');

        // Зберегти в кеш
        await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
        OfflineLogger.auth('Cached user saved', { id: user.id });

        setState({
          user,
          accessToken: savedToken,
          isLoading: false,
          isAuthenticated: true,
          emailVerified: verified === 'true',
        });
        OfflineLogger.auth('User loaded from server successfully');
      } catch (error) {
        OfflineLogger.auth('Failed to load user from server', { error: String(error) });
        setState((s) => ({ ...s, isLoading: false }));
      }
    };
    loadUserOnStartup();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // Перевірка доступності сервера
    const serverOk = await checkServerReachable();
    if (!serverOk) {
      throw new Error('Сервер недоступний. Перевірте підключення до мережі.');
    }

    const response = await authApi.login(email, password);
    await SecureStore.setItemAsync('accessToken', response.accessToken);
    await SecureStore.setItemAsync('refreshToken', response.refreshToken);
    const emailVerified = (response as any).emailVerified ?? false;
    await SecureStore.setItemAsync('emailVerified', String(emailVerified));
    const user = response.user as unknown as User;

    // Зберегти в кеш
    await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));

    setState({
      user,
      accessToken: response.accessToken,
      isLoading: false,
      isAuthenticated: true,
      emailVerified,
    });

    // ДОДАТИ: Примусова синхронізація після входу
    try {
      const { SyncService } = await import('../db/SyncService');
      await SyncService.sync(user.id);
    } catch (e) {
      console.warn('Post-login sync failed', e);
    }
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    const response = await authApi.register(data); // тепер передає systemRole
    await SecureStore.setItemAsync('accessToken', response.accessToken);
    await SecureStore.setItemAsync('refreshToken', response.refreshToken);
    await SecureStore.setItemAsync('emailVerified', 'false'); // нова реєстрація = не підтверджено
    const user = response.user as unknown as User;

    // Зберегти в кеш
    await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));

    setState({
      user,
      accessToken: response.accessToken,
      isLoading: false,
      isAuthenticated: true,
      emailVerified: false,
    });
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ігноруємо помилку */ }
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    await SecureStore.deleteItemAsync('emailVerified');
    await SecureStore.deleteItemAsync('biometricEnabled');
    await AsyncStorage.removeItem(CACHED_USER_KEY);
    
    // Очистка БД при виході
    try {
      const { database } = await import('../db/index');
      await database.write(async () => {
        await database.unsafeResetDatabase();
      });
    } catch (e) {
      console.warn('DB cleanup failed', e);
    }
    
    setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false, emailVerified: false });
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const user = await authApi.getMe();
      // Оновити кеш
      await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
      setState((s) => ({ ...s, user }));
    } catch { /* silent */ }
  }, []);

  const setEmailVerified = useCallback((value: boolean) => {
    SecureStore.setItemAsync('emailVerified', String(value)).catch(() => {});
    setState((s) => ({ ...s, emailVerified: value }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshUser, setEmailVerified }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
