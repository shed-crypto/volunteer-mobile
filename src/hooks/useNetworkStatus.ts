import { useState, useEffect, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

/**
 * ВИПРАВЛЕННЯ: useState(true) → useState<boolean | null>(null)
 *
 * Проблема: якщо стартувати з true, перший рендер вважає пристрій онлайн.
 * Всі екрани йдуть в API, отримують Network Error, і тільки тоді намагаються
 * читати з локальної БД. Це зайва затримка (axios timeout) + шум в логах.
 *
 * Нова логіка: null = "ще не відомо", false = офлайн, true = онлайн.
 * Екрани повинні перевіряти: if (isOnline !== false) { API } else { DB }
 * Або: if (isOnline === null || isOnline) { API } else { DB }
 */
export function useNetworkStatus() {
  // null = стан ще не визначено (до першої відповіді NetInfo)
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!(state.isConnected && state.isInternetReachable);
      setIsOnline((prev) => {
        if (prev === false && online) setWasOffline(true);
        return online;
      });
    });

    // Початкова перевірка — встановлює реальний стан одразу
    NetInfo.fetch().then((state) => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });

    return unsubscribe;
  }, []);

  return { isOnline, wasOffline };
}