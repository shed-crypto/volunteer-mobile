// src/context/NetworkContext.tsx
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState, AppStateStatus } from 'react-native';
import { checkServerReachable, setServerReachable } from '../api/axios';
import { SyncService } from '../db/SyncService';
import { OfflineLogger } from '../utils/offlineLogger';

interface NetworkContextType {
  isConnected: boolean;        // є мережа взагалі
  isServerReachable: boolean;  // сервер доступний
  isOffline: boolean;          // зручне: !isConnected || !isServerReachable
  lastChecked: number | null;
  recheckServer: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextType>({
  isConnected: true,
  isServerReachable: true,
  isOffline: false,
  lastChecked: null,
  recheckServer: async () => true,
});

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);
  const [isServerReachable, setIsServerReachableState] = useState(true);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recheckServer = useCallback(async (): Promise<boolean> => {
    OfflineLogger.network('recheckServer called');
    const wasPreviouslyReachable = isServerReachable;
    const result = await checkServerReachable();
    setIsServerReachableState(result);
    setServerReachable(result);
    setLastChecked(Date.now());
    OfflineLogger.network(`recheckServer result: ${result}`);
    
    // Якщо сервер став доступним (був недоступний) — запустити синхронізацію черги
    if (result && !wasPreviouslyReachable) {
      OfflineLogger.network('Server became reachable — triggering sync');
      SyncService.sync(undefined, true).catch((err) => {
        OfflineLogger.sync('Auto-sync after reconnect failed', err);
      });
    }
    
    return result;
  }, [isServerReachable]);

  // Слухати зміни мережі
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected);
      OfflineLogger.network(`NetInfo changed: connected=${connected}, type=${state.type}`);
      setIsConnected(connected);
      
      if (!connected) {
        setIsServerReachableState(false);
        setServerReachable(false);
        OfflineLogger.network('No network — server marked unreachable');
      } else {
        // Мережа з'явилась — перевірити сервер через 1.5 секунди
        setTimeout(() => recheckServer(), 1500);
      }
    });

    // Слухати AppState — при поверненні в foreground перевіряти
    const appStateListener = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        OfflineLogger.network('App became active — rechecking server');
        recheckServer();
      }
    });

    // Перша перевірка
    recheckServer();

    // Перевіряти кожні 30 секунд (тільки якщо додаток активний)
    checkIntervalRef.current = setInterval(() => {
      if (AppState.currentState === 'active') {
        recheckServer();
      }
    }, 30000);

    return () => {
      unsubscribe();
      appStateListener.remove();
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, [recheckServer]);

  return (
    <NetworkContext.Provider value={{
      isConnected,
      isServerReachable,
      isOffline: !isConnected || !isServerReachable,
      lastChecked,
      recheckServer,
    }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
