import { useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BIOMETRIC_ENABLED_KEY = 'biometricEnabled';
const SAVED_EMAIL_KEY        = 'savedEmail';
const SAVED_PASSWORD_KEY     = 'savedPassword';

export interface BiometricState {
  /** Чи підтримує пристрій біометрію та чи є налаштований відбиток/обличчя */
  isSupported: boolean;
  /** Чи ввімкнена біометрія для цього акаунта */
  isEnabled: boolean;
}

/**
 * useBiometrics — системний хук для біометричної авторизації.
 *
 * Архітектура:
 *   1. При першому успішному вході користувач може ввімкнути біометрію.
 *   2. Credentials (email + пароль) зберігаються у expo-secure-store
 *      (зашифрований KeyStore/Keychain на рівні ОС).
 *   3. При наступному відкритті → fingerprint/FaceID → автовхід.
 *
 * Безпека:
 *   - Credentials ніколи не зберігаються у plain text.
 *   - expo-secure-store використовує Android Keystore / iOS Keychain.
 *   - При logout всі збережені credentials видаляються.
 */
export function useBiometrics() {

  /** Перевірити підтримку біометрії на пристрої */
  const checkSupport = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled  = await LocalAuthentication.isEnrolledAsync();
      return hasHardware && isEnrolled;
    } catch {
      return false;
    }
  }, []);

  /** Перевірити чи ввімкнена біометрія для поточного акаунта */
  const isBiometricEnabled = useCallback(async (): Promise<boolean> => {
    const val = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return val === 'true';
  }, []);

  /**
   * Ввімкнути біометрію — зберігаємо credentials після підтвердження.
   * Викликати після успішного звичайного входу.
   */
  const enableBiometric = useCallback(async (
    email: string,
    password: string,
  ): Promise<boolean> => {
    const supported = await checkSupport();
    if (!supported) return false;

    // Просимо підтвердити перед збереженням
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Підтвердіть особу для активації біометрії',
      cancelLabel: 'Скасувати',
      disableDeviceFallback: false,
    });

    if (!result.success) return false;

    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
    await SecureStore.setItemAsync(SAVED_EMAIL_KEY, email);
    await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password);
    return true;
  }, [checkSupport]);

  /** Вимкнути біометрію та видалити збережені credentials */
  const disableBiometric = useCallback(async (): Promise<void> => {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    await SecureStore.deleteItemAsync(SAVED_EMAIL_KEY);
    await SecureStore.deleteItemAsync(SAVED_PASSWORD_KEY);
  }, []);

  /**
   * Спробувати увійти через біометрію.
   * Повертає { email, password } якщо успішно, або null якщо не вдалося.
   */
  const authenticateWithBiometric = useCallback(async (): Promise<
    { email: string; password: string } | null
  > => {
    const enabled   = await isBiometricEnabled();
    const supported = await checkSupport();
    if (!enabled || !supported) return null;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Увійти у Волонтерську допомогу',
      fallbackLabel: 'Ввести пароль',
      cancelLabel: 'Скасувати',
      disableDeviceFallback: false,
    });

    if (!result.success) return null;

    const email    = await SecureStore.getItemAsync(SAVED_EMAIL_KEY);
    const password = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);

    if (!email || !password) {
      // Credentials зникли — вимикаємо біометрію
      await disableBiometric();
      return null;
    }

    return { email, password };
  }, [checkSupport, isBiometricEnabled, disableBiometric]);

  /** Отримати поточний стан (для UI-перемикача в налаштуваннях) */
  const getBiometricState = useCallback(async (): Promise<BiometricState> => {
    const [isSupported, isEnabled] = await Promise.all([
      checkSupport(),
      isBiometricEnabled(),
    ]);
    return { isSupported, isEnabled };
  }, [checkSupport, isBiometricEnabled]);

  return {
    checkSupport,
    isBiometricEnabled,
    enableBiometric,
    disableBiometric,
    authenticateWithBiometric,
    getBiometricState,
  };
}
