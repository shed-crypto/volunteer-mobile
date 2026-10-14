# Волонтерська допомога — Mobile App (Frontend)

[![Mobile Frontend CI](https://github.com/shed-crypto/volunteer-mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/shed-crypto/volunteer-mobile/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE.md)
[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=black)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-54-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

React Native / Expo застосунок для волонтерів та координаторів.  
Стек: **Expo SDK 54 · React Native 0.81 · TypeScript · WatermelonDB · Socket.IO**

---

## Зміст

- [Вимоги](#вимоги)
- [Швидкий старт](#швидкий-старт)
- [Змінні середовища](#змінні-середовища)
- [Запуск на пристрої/емуляторі](#запуск-на-пристроїемуляторі)
- [Структура проекту](#структура-проекту)
- [Збірка (Production Build)](#збірка-production-build)
- [Відомі особливості](#відомі-особливості)

---

## Вимоги

| Інструмент | Версія |
|-----------|--------|
| Node.js   | 20 LTS |
| npm       | 10+    |
| Expo CLI  | `npm install -g expo-cli` |
| EAS CLI   | `npm install -g eas-cli` (для збірки) |
| Android Studio | Для Android-емулятора |
| Xcode 15+ | Для iOS-симулятора (тільки macOS) |

---

## Швидкий старт

```bash
# 1. Встановити залежності
cd frontend/
npm install

# 2. Налаштувати змінні середовища
cp .env.example .env
# Відкрити .env і вписати:
#   EXPO_PUBLIC_API_URL=http://<IP вашого комп'ютера>:3000/api
#   GOOGLE_MAPS_API_KEY_ANDROID=<ваш ключ>
#   GOOGLE_MAPS_API_KEY_IOS=<ваш ключ>

# 3. Запустити Metro bundler
npx expo start
```

Після запуску Metro відкриється QR-код.  
Відскануйте його у додатку **Expo Go** на своєму телефоні.

---

## Змінні середовища

Скопіювати `.env.example` → `.env`:

| Змінна | Опис | Обов'язкова |
|--------|------|-------------|
| `EXPO_PUBLIC_API_URL` | URL бекенду (з `/api` на кінці) | **Так** |
| `GOOGLE_MAPS_API_KEY_ANDROID` | Google Maps ключ для Android | Так (для карти) |
| `GOOGLE_MAPS_API_KEY_IOS` | Google Maps ключ для iOS | Так (для карти) |

### Як визначити EXPO_PUBLIC_API_URL

- **Android-емулятор:** `http://10.0.2.2:3000/api`
- **iOS-симулятор:** `http://localhost:3000/api`
- **Реальний пристрій по Wi-Fi:** `http://192.168.X.X:3000/api`  
  (замінити X.X на IP вашого ПК — `ipconfig` / `ifconfig`)
- **Production:** `https://api.your-domain.com/api`

### Як отримати Google Maps API ключ

1. Відкрити [Google Cloud Console](https://console.cloud.google.com/)
2. APIs & Services → Credentials → Create Credentials → API Key
3. Увімкнути: **Maps SDK for Android** та **Maps SDK for iOS**
4. Обмежити ключ по package name (`com.volunteer.app`)

> **Без ключа:** застосунок запуститься, але вкладка «Карта» покаже порожній екран.

---

## Запуск на пристрої/емуляторі

### Expo Go (найшвидший спосіб — тільки для розробки)
```bash
npx expo start
# Відсканувати QR у додатку Expo Go на телефоні
```

> ⚠️ Expo Go не підтримує деякі нативні модулі (biometrics, maps).  
> Для повного тестування використовуйте Development Build.

### Development Build (рекомендовано)
```bash
# Android (потрібен Android Studio + увімкнений режим розробника на пристрої)
npx expo run:android

# iOS (тільки macOS, потрібен Xcode)
npx expo run:ios
```

### Емулятор Android
1. Відкрити Android Studio → Device Manager → запустити AVD
2. `npx expo run:android`

### Симулятор iOS (macOS)
1. `npx expo run:ios`  
   (автоматично відкриє симулятор)

---

## Структура проекту

```
src/
├── api/                   HTTP клієнти для кожного модуля
│   ├── axios.ts           Axios instance (JWT interceptor, refresh)
│   ├── auth.api.ts        Реєстрація, вхід, logout
│   ├── tasks.api.ts       Задачі (Kanban)
│   ├── requests.api.ts    Заявки
│   ├── chat.api.ts        Чати
│   ├── orgs.api.ts        Організації
│   └── users.api.ts       Профіль, транспорт
├── components/
│   ├── ui.tsx             Загальні UI-компоненти (Button, Card, Input...)
│   ├── OfflineBanner.tsx  Банер про відсутність мережі
│   └── EmailVerificationBanner.tsx  Банер непідтвердженого email
├── context/
│   └── AuthContext.tsx    Глобальний стан авторизації
├── db/                    Offline-first база (WatermelonDB + expo-sqlite)
│   ├── schema.ts          Схема локальної БД
│   ├── index.ts           Ініціалізація
│   ├── SyncService.ts     Синхронізація з сервером
│   └── models/            Моделі: Task, Request, ChatMessage, UserCache
├── hooks/
│   ├── useSocket.ts       WebSocket хук (Socket.IO)
│   ├── useNetworkStatus.ts Статус мережі (NetInfo)
│   └── useBiometrics.ts   Face ID / Touch ID (expo-local-authentication)
├── navigation/
│   ├── RootNavigator.tsx  Корінь: Auth / Main
│   ├── AuthNavigator.tsx  Login / Register
│   └── MainNavigator.tsx  Tab-навігація + стеки екранів
├── screens/
│   ├── auth/              LoginScreen, RegisterScreen
│   ├── requests/          RequestsList, RequestDetail, CreateRequest
│   ├── tasks/             TaskDetail (перегляд/редагування задачі)
│   ├── kanban/            KanbanScreen (Kanban-дошка заявки)
│   ├── map/               MapScreen (карта заявок)
│   ├── chat/              ChatsList, ChatRoom
│   ├── profile/           Profile, EditProfile, Vehicles, UserProfile
│   ├── organizations/     OrganizationsScreen, OrgDetailScreen
│   └── admin/             AdminScreen (тільки для ADMIN)
├── services/
│   └── sync.service.ts    Автоматична синхронізація при відновленні мережі
├── types/
│   └── index.ts           Всі TypeScript інтерфейси та типи
└── utils/
    └── theme.ts           Кольори, розміри, стилі
```

---

## Збірка (Production Build)

Використовується **EAS Build** (хмарна збірка від Expo).

```bash
# 1. Авторизація в EAS
eas login

# 2. Налаштувати eas.json (вже є у проекті)

# 3. Android APK (для тестування)
eas build --platform android --profile preview

# 4. Android AAB (для Google Play)
eas build --platform android --profile production

# 5. iOS IPA
eas build --platform ios --profile production
```

**Передати Google Maps ключі для EAS Build:**
```bash
eas secret:create --scope project --name GOOGLE_MAPS_API_KEY_ANDROID --value "AIzaSy..."
eas secret:create --scope project --name GOOGLE_MAPS_API_KEY_IOS     --value "AIzaSy..."
```

---

## Відомі особливості

| Особливість | Деталі |
|-------------|--------|
| **Offline режим** | Заявки та задачі кешуються в WatermelonDB. При відновленні мережі синхронізуються автоматично |
| **Biometrics** | Face ID / Touch ID для входу — замінює введення пароля (expo-local-authentication) |
| **Email верифікація** | Після реєстрації показується банер поки не підтверджено пошту. Деякі функції можуть бути обмежені |
| **WebSocket** | Чати працюють у реальному часі через Socket.IO. При offline — повідомлення не надходять |
| **KanbanScreen** | Доступний з деталей заявки. Дозволяє переміщати задачі між статусами одним дотиком |
| **Карта** | Потребує Google Maps API ключ. Показує заявки поруч з поточним місцезнаходженням |

---

## Тестування

```bash
# Запуск unit-тестів (Jest)
npm test
```
