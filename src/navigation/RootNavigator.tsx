import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { NetworkProvider } from '../context/NetworkContext';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import { Colors } from '../utils/theme';

// ─── Root Stack Param List ────────────────────────────────────────────────────
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  RequestDetail: { requestId: string };
  CreateRequest: undefined;
  ChatRoom: { chatId: string; chatName?: string };
  UserProfile: { userId: string };
  TaskDetail: { taskId: string; requestId?: string; requestTitle?: string };
  ChatSettings: { chatId: string; chatName?: string; isGroupChat: boolean };
  Organizations: undefined;
  OrgDetail: { orgId: string };
  OrgSearch: undefined;
  OrgEdit: { orgId: string };
  OrgSettings: { orgId: string };
  OrgJoinRequests: { orgId: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <NetworkProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {isAuthenticated ? (
            <Stack.Screen name="Main" component={MainNavigator} />
          ) : (
            <Stack.Screen name="Auth" component={AuthNavigator} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </NetworkProvider>
  );
}
