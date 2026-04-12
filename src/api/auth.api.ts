import api from './axios';
import { AuthResponse, SystemRole } from '../types';

export const authApi = {
  register: (data: {
    email: string;
    password: string;
    fullName: string;
    phoneNumber?: string;
    systemRole?: SystemRole;  // ← виправлено: передаємо роль
  }): Promise<AuthResponse> =>
    api.post('/auth/register', data).then((r) => r.data),

  login: (email: string, password: string): Promise<AuthResponse> =>
    api.post('/auth/login', { email, password }).then((r) => r.data),

  logout: (): Promise<void> =>
    api.post('/auth/logout').then(() => undefined),

  getMe: () =>
    api.get('/auth/me').then((r) => r.data),

  /** Підтвердити email за токеном із листа */
  verifyEmail: (token: string): Promise<{ message: string }> =>
    api.get(`/auth/verify-email?token=${token}`).then((r) => r.data),

  /** Повторно надіслати лист підтвердження */
  resendVerification: (): Promise<{ message: string }> =>
    api.post('/auth/resend-verification').then((r) => r.data),
};
