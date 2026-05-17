import api from './axios';
import { AuthResponse, SystemRole } from '../types';

export const authApi = {
  register: (data: {
    email: string;
    password: string;
    fullName: string;
    phoneNumber?: string;
    systemRole?: SystemRole;
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

  /**
   * Запит на скидання пароля.
   * Надсилає 6-значний код на email.
   * Повертає { message, exists } — exists=false якщо email не знайдено.
   */
  requestPasswordReset: (email: string): Promise<{ message: string; exists: boolean }> =>
    api.post('/auth/forgot-password', { email }).then((r) => r.data),

  /**
   * Підтвердити 6-значний код з листа.
   * Повертає одноразовий токен для скидання пароля.
   */
  verifyResetCode: (email: string, code: string): Promise<{ token: string; message: string }> =>
    api.post('/auth/verify-reset-code', { email, code }).then((r) => r.data),

  /**
   * Встановити новий пароль (після підтвердження коду).
   */
  resetPassword: (token: string, newPassword: string): Promise<{ message: string }> =>
    api.post('/auth/reset-password', { token, newPassword }).then((r) => r.data),

  changePassword: (oldPassword: string, newPassword: string): Promise<{ message: string }> =>
    api.post('/auth/change-password', { oldPassword, newPassword }).then((r) => r.data),
};