import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { SyncService } from './src/db/SyncService';
import { SyncEventLogger } from './src/services/SyncEventLogger';
import { AppState, AppStateStatus, Alert } from 'react-native';
import { Q } from '@nozbe/watermelondb';
import { collections } from './src/db';
import { navigationRef } from './src/navigation/RootNavigator';
import { usersApi } from './src/api/users.api';
import { locationHelper } from './src/utils/locationHelper';
function SyncWrapper({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  useEffect(() => {
    SyncEventLogger.init();
    if (!user?.id) return;
    
    const unsub = SyncService.startNetworkListener(user.id);
    SyncService.sync(user.id);
    
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        try {
          const activeTasks = await collections.taskAssignments
            .query(
              Q.where('user_id', user.id),
              Q.where('status', Q.oneOf(['IN_PROGRESS', 'EN_ROUTE', 'ON_SITE']))
            ).fetchCount();
          
          if (activeTasks > 0) {
            Alert.alert(
              'Перевірка безпеки',
              'Ви все ще в безпеці?',
              [
                {
                  text: 'Ні / Потрібна допомога',
                  style: 'destructive',
                  onPress: () => {
                    if (navigationRef.isReady()) {
                      // @ts-ignore
                      navigationRef.navigate('Main', {
                        screen: 'Requests',
                        params: { screen: 'CreateRequest', params: { isSos: true } }
                      });
                    }
                  }
                },
                {
                  text: 'Так',
                  style: 'default',
                  onPress: async () => {
                    const loc = await locationHelper.getCurrentLocation(false);
                    if (loc) {
                      usersApi.checkin(loc.latitude, loc.longitude).catch(console.error);
                    }
                  }
                }
              ]
            );
          }
        } catch (e) {
          console.error('AppState error:', e);
        }
      }
    };
    
    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      unsub();
      appStateSub.remove();
    };
  }, [user?.id]);

  return <>{children}</>;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SyncWrapper>
            <StatusBar style="light" />
            <RootNavigator />
          </SyncWrapper>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}