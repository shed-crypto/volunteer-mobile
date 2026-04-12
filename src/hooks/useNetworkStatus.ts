import { useState, useEffect } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!(state.isConnected && state.isInternetReachable);
      setIsOnline((prev) => {
        if (!prev && online) setWasOffline(true);
        return online;
      });
    });

    // Початкова перевірка
    NetInfo.fetch().then((state) => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });

    return unsubscribe;
  }, []);

  return { isOnline, wasOffline };
}
