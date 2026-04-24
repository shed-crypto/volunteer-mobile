import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authApi } from '../api/auth.api';
import { User, SystemRole, ClearanceLevel } from '../types';
import { SyncService } from '../db/SyncService';

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
    const bootstrap = async () => {
      try {
        const token = await SecureStore.getItemAsync('accessToken');
        if (token) {
          const user = await authApi.getMe();
          const verified = await SecureStore.getItemAsync('emailVerified');
          setState({
            user,
            accessToken: token,
            isLoading: false,
            isAuthenticated: true,
            emailVerified: verified === 'true',
          });
          // ВИПРАВЛЕННЯ: запускаємо sync після успішного bootstrap
          // щоб локальна БД заповнилась актуальними даними
          SyncService.sync().catch((err) =>
            console.warn('[AuthContext] Bootstrap sync failed:', err)
          );
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      } catch {
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
        await SecureStore.deleteItemAsync('emailVerified');
        setState((s) => ({ ...s, isLoading: false }));
      }
    };
    bootstrap();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    await SecureStore.setItemAsync('accessToken', response.accessToken);
    await SecureStore.setItemAsync('refreshToken', response.refreshToken);
    await SecureStore.setItemAsync('emailVerified', String(response.emailVerified ?? false));
    const user = response.user as unknown as User;
    setState({
      user,
      accessToken: response.accessToken,
      isLoading: false,
      isAuthenticated: true,
      emailVerified: response.emailVerified ?? false,
    });
    // ВИПРАВЛЕННЯ: запускаємо sync після логіну, не блокуємо UI
    SyncService.sync().catch((err) =>
      console.warn('[AuthContext] Login sync failed:', err)
    );
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    const response = await authApi.register(data);
    await SecureStore.setItemAsync('accessToken', response.accessToken);
    await SecureStore.setItemAsync('refreshToken', response.refreshToken);
    await SecureStore.setItemAsync('emailVerified', 'false');
    const user = response.user as unknown as User;
    setState({
      user,
      accessToken: response.accessToken,
      isLoading: false,
      isAuthenticated: true,
      emailVerified: false,
    });
    // ВИПРАВЛЕННЯ: sync після реєстрації
    SyncService.sync().catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ігноруємо помилку */ }
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    await SecureStore.deleteItemAsync('emailVerified');
    await SecureStore.deleteItemAsync('biometricEnabled');
    setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false, emailVerified: false });
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const user = await authApi.getMe();
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