/**
 * app.config.js — ДИНАМІЧНА конфігурація Expo
 *
 * ЧОМУ app.config.js замість app.json?
 * ─────────────────────────────────────
 * app.json — статичний файл. Якщо вписати туди реальний Google Maps API Key,
 * він одразу потрапить у git-репозиторій → витік ключа.
 *
 * app.config.js — читає process.env під час збірки (EAS Build / локально),
 * тобто ключ ніколи не зберігається у файлах проекту.
 *
 * ЯК ПЕРЕДАТИ КЛЮЧ?
 * ─────────────────
 * 1. ЛОКАЛЬНА РОЗРОБКА (expo start):
 *    Створити файл .env у корені frontend/ (він у .gitignore):
 *      GOOGLE_MAPS_API_KEY_ANDROID=AIzaSy...
 *      GOOGLE_MAPS_API_KEY_IOS=AIzaSy...
 *    Expo автоматично читає .env під час `expo start` (з SDK 49+).
 *    АБО встановити dotenv і підключити вручну (див. нижче).
 *
 * 2. EAS BUILD (хмарна збірка):
 *    eas secret:create --scope project --name GOOGLE_MAPS_API_KEY_ANDROID --value "AIzaSy..."
 *    eas secret:create --scope project --name GOOGLE_MAPS_API_KEY_IOS     --value "AIzaSy..."
 *    EAS автоматично підставить їх у process.env під час збірки.
 *
 * 3. CI/CD (GitHub Actions тощо):
 *    Зберігати як encrypted secrets у налаштуваннях репозиторію.
 *    Передавати через env: у workflow файлі.
 *
 * ЧИ ОБОВ'ЯЗКОВИЙ КЛЮЧ?
 * ──────────────────────
 * Android: ТАК, завжди обов'язковий — Google Maps SDK не запуститься без нього.
 * iOS:     ТАК, якщо використовується Google Maps provider.
 *          НІ, якщо provider="default" (тоді Apple Maps, ключ не потрібен).
 *
 * У цьому проекті MapScreen використовує react-native-maps з Google Maps
 * на обох платформах — тому КЛЮЧ ОБОВ'ЯЗКОВИЙ.
 */

// Expo SDK 49+ автоматично завантажує .env.
// Якщо використовуєш старіші версії — розкоментуй:
// require('dotenv').config();

export default {
  expo: {
    name: 'Волонтерська допомога',
    slug: 'volunteer-app',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#1a56db',
    },

    ios: {
      supportsTablet: true,
      newArchEnabled: false,
      bundleIdentifier: 'com.volunteer.app',
      config: {
        // Ключ читається з env-змінної — НІКОЛИ не вписувати сюди рядком!
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY_IOS,
      },
      infoPlist: {
        NSFaceIDUsageDescription: 'Використовується для швидкого входу в застосунок',
        NSLocationWhenInUseUsageDescription: 'Потрібна для відображення заявок поруч з вами',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'Потрібна для відстеження маршруту волонтера',
      },
    },

    android: {
      adaptiveIcon: {
        backgroundColor: '#1a56db',
      },
      package: 'com.volunteer.app',
      newArchEnabled: false,
      config: {
        googleMaps: {
          // Ключ читається з env-змінної — НІКОЛИ не вписувати сюди рядком!
          apiKey: process.env.GOOGLE_MAPS_API_KEY_ANDROID,
        },
      },
      permissions: [
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'USE_BIOMETRIC',
        'USE_FINGERPRINT',
      ],
    },

    plugins: [
      'expo-secure-store',
      'expo-sqlite',
      'expo-location',
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'Використовується для швидкого входу в застосунок',
        },
      ],
    ],

    extra: {
      eas: {
        projectId: 'f485357b-eda6-4648-b297-fa8d7787caf4',
      },
    },
  },
};
