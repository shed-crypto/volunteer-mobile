import 'react-native-gesture-handler';

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import NetInfo from '@react-native-community/netinfo';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { SyncService } from './src/db/SyncService';

export default function App() {
  useEffect(() => {
    // ВИПРАВЛЕННЯ: при відновленні з'єднання автоматично синхронізуємо
    // локальну БД з сервером (push відкладених дій + pull нових даних)
    let prevConnected = false;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const isConnected = !!(state.isConnected && state.isInternetReachable);
      if (isConnected && !prevConnected) {
        console.log('[App] Мережа відновлена — запускаємо синхронізацію...');
        SyncService.sync().catch((err) =>
          console.warn('[App] Sync on reconnect failed:', err)
        );
      }
      prevConnected = isConnected;
    });

    return unsubscribe;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}